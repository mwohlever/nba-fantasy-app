import { NextResponse } from "next/server";

import { buildGolfValues, GOLF_VALUE_VERSION } from "@/lib/golf/valueModel";
import { buildGolfBoardInputManifest } from "@/lib/golf/valueAnalytics";
import { loadGolfAnalyticsHistory } from "@/lib/golf/valueAnalytics.server";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatGolfMoney } from "@/lib/golf/money";

type SetupAction = "generate" | "override" | "freeze" | "open_weekend";

function validSlateId(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function rpcFailure(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export async function GET(request: Request) {
  const slateId = validSlateId(new URL(request.url).searchParams.get('slateId'));
  if (!slateId) return NextResponse.json({ error: 'Valid slate required.' }, { status: 400 });
  const authorization = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
  if (!authorization.ok) return authorization.response;
  try {
    const result = await supabaseAdmin.from('golf_salary_price_sets').select('id, status, revision').eq('slate_id', slateId).maybeSingle();
    rpcFailure('Salary board unavailable', result.error);
    const rows = result.data ? await supabaseAdmin.from('golf_salary_prices')
      .select('player_id, suggested_salary, override_salary, effective_salary, is_amateur, value_basis, golf_players!inner(display_name)')
      .eq('price_set_id', result.data.id).order('suggested_salary', { ascending: false, nullsFirst: false }) : { data: [], error: null };
    rpcFailure('Salary prices unavailable', rows.error);
    return NextResponse.json({ priceSet: result.data, prices: (rows.data ?? []).map((row: any) => ({ ...row,
      suggested_salary: row.suggested_salary === null ? null : formatGolfMoney(row.suggested_salary),
      override_salary: row.override_salary === null ? null : formatGolfMoney(row.override_salary),
      effective_salary: row.effective_salary === null ? null : formatGolfMoney(row.effective_salary),
    })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Salary setup unavailable.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { slateId?: unknown; action?: SetupAction; expectedRevision?: number; overrides?: unknown; acknowledgeUnpriced?: boolean };
    const slateId = validSlateId(body.slateId);
    const action = body.action;
    if (!slateId || !action || !["generate", "override", "freeze", "open_weekend"].includes(action)) {
      return NextResponse.json({ error: "A valid slateId and setup action are required." }, { status: 400 });
    }
    const authorization = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
    if (!authorization.ok) return authorization.response;
    if (!authorization.user) return NextResponse.json({ error: "Commissioner login required." }, { status: 401 });

    const { data: slate, error: slateError } = await supabaseAdmin.from("slates")
      .select("id, sport, league_id, rules_snapshot, start_date, external_event_id, display_name, has_cut")
      .eq("id", slateId).single();
    if (slateError || !slate) return NextResponse.json({ error: "Golf slate not found." }, { status: 404 });
    const rules = slate.rules_snapshot as Record<string, any> | null;
    if (slate.sport !== "golf" || (rules?.draft?.type !== "salary_cap" && action !== 'open_weekend')) {
      return NextResponse.json({ error: "A frozen Golf Salary Cap slate is required." }, { status: 400 });
    }

    const scope = {
      p_slate: slateId,
      p_group: authorization.target.groupId,
      p_league: authorization.target.leagueId,
      p_actor: authorization.user.id,
    };
    const initialized = await supabaseAdmin.rpc("initialize_golf_lifecycle", scope);
    rpcFailure("Golf lifecycle initialization failed", initialized.error);

    if (action === "override" || action === "freeze") {
      if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
        return NextResponse.json({ error: "Reload the salary review before saving." }, { status: 400 });
      }
      const reviewed = await supabaseAdmin.rpc("review_golf_salary_prices", {
        ...scope, p_action: action, p_expected_revision: body.expectedRevision,
        p_overrides: body.overrides ?? [], p_acknowledge_unpriced: body.acknowledgeUnpriced === true,
      });
      if (reviewed.error) return NextResponse.json({ error: reviewed.error.message }, { status: /changed/.test(reviewed.error.message) ? 409 : 400 });
      if (action === "override") return NextResponse.json({ success: true, priceSet: reviewed.data });
    }

    if (action === "generate") {
      const existing = await supabaseAdmin.from("golf_salary_price_sets").select("id, status, revision").eq("slate_id", slateId).maybeSingle();
      rpcFailure("Existing Golf prices could not be checked", existing.error);
      let priceSet = existing.data;
      if (!priceSet) {
        const field = await supabaseAdmin.from("golf_event_players")
          .select("player_id, is_amateur, golf_players!inner(display_name, espn_player_id, owgr_rank, owgr_updated_at)")
          .eq("slate_id", slateId);
        rpcFailure("Golf field could not be loaded", field.error);
        if (!field.data?.length) return NextResponse.json({ error: "Import the tournament field before generating salaries." }, { status: 409 });
        if (!slate.external_event_id) return NextResponse.json({ error: "ESPN tournament identity required before generating salaries." }, { status: 409 });
        const asOfAt = new Date().toISOString();
        const startsAt = `${slate.start_date}T00:00:00.000Z`;
        const season = Number(String(slate.start_date).slice(0, 4));
        const fieldInputs = field.data.map((row: any) => {
          const player = Array.isArray(row.golf_players) ? row.golf_players[0] : row.golf_players;
          return { playerId: Number(row.player_id), espnPlayerId: String(player.espn_player_id),
            identityStatus: /^\d+$/.test(String(player.espn_player_id)) ? 'espn_resolved' as const : 'pga_unresolved' as const,
            name: String(player.display_name), isAmateur: Boolean(row.is_amateur),
            owgrRank: player.owgr_rank === null ? null : Number(player.owgr_rank),
            owgrUpdatedAt: player.owgr_updated_at ?? null };
        });
        const resolvedField = fieldInputs.filter(player => player.identityStatus === 'espn_resolved');
        if (!resolvedField.length) return NextResponse.json({ error: "No field golfers currently have a safe numeric ESPN identity for salary generation." }, { status: 409 });
        const analytics = await loadGolfAnalyticsHistory({
          playerIds: resolvedField.map(player => player.playerId),
          espnPlayerIds: resolvedField.map(player => player.espnPlayerId),
          targetEventId: String(slate.external_event_id),
          targetCutoffAt: startsAt,
          asOfAt,
          season,
        });
        const manifest = buildGolfBoardInputManifest({ targetEventId: String(slate.external_event_id),
          targetCutoffAt: startsAt, asOfAt, refresh: analytics.refresh,
          field: fieldInputs, selection: analytics.selection });
        const conflictedPlayerIds = new Set(analytics.selection.conflicts.map(conflict => conflict.playerId));
        const values = buildGolfValues({
          eventId: String(slate.external_event_id),
          startsAt,
          season,
          players: manifest.field.filter(player => player.identityStatus === 'espn_resolved' && !conflictedPlayerIds.has(player.playerId)).map(player => ({ playerId: String(player.playerId), name: player.name,
            history: analytics.selection.histories.get(String(player.playerId)) ?? [],
            owgrRank: player.owgrRank, owgrUpdatedAt: player.owgrUpdatedAt, isAmateur: player.isAmateur })),
        });
        const pricesByPlayerId = new Map(values.players.map(player => [Number(player.playerId), player]));
        const created = await supabaseAdmin.rpc("create_golf_salary_price_set_with_manifest", {
          ...scope,
          p_manifest: manifest,
          p_prices: manifest.field.map(player => {
            const value = pricesByPlayerId.get(player.playerId);
            return { player_id: player.playerId, suggested_salary: value?.pricing.suggestedSalary ?? null,
              is_amateur: player.isAmateur, value_basis: value?.pricing.basis ?? 'unsupported', value_version: GOLF_VALUE_VERSION };
          }),
        });
        rpcFailure("Golf salary generation failed", created.error);
        priceSet = created.data;
      }
      return NextResponse.json({ success: true, action, priceSet });
    }

    if (action === "freeze") {
      const periodKey = rules?.rosterPeriods?.type === "split_after_round_2" ? "opening" : "full_tournament";
      const period = await supabaseAdmin.from("golf_roster_periods").select("id, revision, opened_at, locked_at").eq("slate_id", slateId).eq("period_key", periodKey).single();
      rpcFailure("Opening Golf lifecycle could not be loaded", period.error);
      if (period.data && !period.data.opened_at && !period.data.locked_at) {
        const teeTimes = await supabaseAdmin.from("golf_event_players").select("tee_time").eq("slate_id", slateId).not("tee_time", "is", null).order("tee_time").limit(1);
        rpcFailure("Golf acquisition deadline could not be loaded", teeTimes.error);
        const deadline = teeTimes.data?.[0]?.tee_time ?? null;
        if (deadline && Date.parse(deadline) > Date.now()) {
          const accepted = await supabaseAdmin.from("golf_accepted_versions").select("revision").eq("slate_id", slateId).single();
          rpcFailure("Accepted Golf version could not be loaded", accepted.error);
          const opened = await supabaseAdmin.rpc("confirm_golf_period_history", {
            ...scope,
            p_period: periodKey,
            p_expected_accepted: accepted.data!.revision,
            p_expected_period: period.data.revision,
            p_action: "opened",
            p_evidence: {
              sourceReference: "golf_event_players:earliest_tee_time",
              observedAt: new Date().toISOString(),
              tournamentComplete: false,
              acquisitionDeadline: deadline,
            },
          });
          rpcFailure("Opening Golf acquisition failed", opened.error);
        }
      }
      return NextResponse.json({ success: true, action, lifecycle: initialized.data });
    }

    if (rules?.rosterPeriods?.type !== "split_after_round_2") {
      return NextResponse.json({ error: "This slate does not have a weekend roster period." }, { status: 400 });
    }
    const field = await supabaseAdmin.from("golf_event_players")
      .select("player_id, status, tee_time, golf_rounds(round_number, holes_completed)").eq("slate_id", slateId);
    rpcFailure("Weekend field evidence could not be loaded", field.error);
    const rows = field.data ?? [];
    const round2Complete = rows.length > 0 && rows.every((row: any) => {
      if (["withdrawn", "disqualified", "did_not_start"].includes(row.status)) return true;
      return (row.golf_rounds ?? []).some((round: any) => Number(round.round_number) === 2 && Number(round.holes_completed) === 18);
    });
    const round3NotStarted = rows.every((row: any) => !(row.golf_rounds ?? []).some((round: any) => Number(round.round_number) >= 3 && Number(round.holes_completed) > 0));
    const futureTeeTimes = rows.map((row: any) => row.tee_time).filter((value: unknown): value is string => typeof value === "string" && Date.parse(value) > Date.now()).sort();
    if (!round2Complete || !round3NotStarted || !futureTeeTimes[0]) {
      return NextResponse.json({ error: "Authoritative Round 2 completion and a future weekend deadline are required." }, { status: 409 });
    }
    const period = await supabaseAdmin.from("golf_roster_periods").select("revision, opened_at, locked_at").eq("slate_id", slateId).eq("period_key", "weekend").single();
    rpcFailure("Weekend lifecycle could not be loaded", period.error);
    if (period.data?.opened_at) return NextResponse.json({ success: true, action, alreadyOpen: true });
    const accepted = await supabaseAdmin.from("golf_accepted_versions").select("revision").eq("slate_id", slateId).single();
    rpcFailure("Accepted Golf version could not be loaded", accepted.error);
    const players = rows.map((row: any) => ({
      playerId: Number(row.player_id),
      eligibility: row.status === "cut" ? "missed_cut"
        : row.status === "withdrawn" ? "withdrawn"
          : row.status === "disqualified" ? "disqualified"
            : row.status === "did_not_start" ? "did_not_start" : "continuing",
    }));
    const opened = await supabaseAdmin.rpc("confirm_golf_period_history", {
      ...scope,
      p_period: "weekend",
      p_expected_accepted: accepted.data!.revision,
      p_expected_period: period.data!.revision,
      p_action: "opened",
      p_evidence: {
        sourceReference: "accepted_golf_state:round_2_complete",
        observedAt: new Date().toISOString(),
        tournamentComplete: false,
        acquisitionDeadline: futureTeeTimes[0],
        round2Complete: true,
        round3NotStarted: true,
        regulationRoundCount: 4,
        cut: slate.has_cut === false ? "no_cut" : "confirmed",
        fieldComplete: true,
        players,
      },
    });
    rpcFailure("Weekend Golf acquisition failed", opened.error);
    return NextResponse.json({ success: true, action, period: opened.data });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Golf Salary Cap setup failed." }, { status: 500 });
  }
}
