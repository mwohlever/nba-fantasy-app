import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getActiveSlateAccessForUser } from "@/lib/groups/context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PeriodKey = "full_tournament" | "opening" | "weekend";

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isPeriodKey(value: unknown): value is PeriodKey {
  return value === "full_tournament" || value === "opening" || value === "weekend";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function salaryCapRules(snapshot: unknown) {
  const rules = objectValue(snapshot);
  const draft = objectValue(rules?.draft);
  const roster = objectValue(rules?.roster);
  const periods = objectValue(rules?.rosterPeriods);
  const slots = Array.isArray(roster?.slots) ? roster.slots : [];
  const rosterSize = slots.reduce((total, rawSlot) => {
    const slot = objectValue(rawSlot);
    const count = Number(slot?.slotCount);
    return total + (Number.isSafeInteger(count) && count > 0 ? count : 0);
  }, 0);
  const budget = Number(draft?.salaryCap);

  if (draft?.type !== "salary_cap" || rosterSize !== 4 || budget !== 100) return null;
  return {
    budget,
    rosterSize,
    periodType: periods?.type === "split_after_round_2"
      ? "split_after_round_2" as const
      : "full_tournament" as const,
  };
}

async function loadAccess(slateId: number) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Login required." }, { status: 401 }) };
  const access = await getActiveSlateAccessForUser(user, slateId);
  if (!access || access.slate.sport !== "golf") {
    return { response: NextResponse.json({ error: "Golf slate not found in the active Group." }, { status: 404 }) };
  }
  const rules = salaryCapRules(access.slate.rulesSnapshot);
  if (!rules) {
    return { response: NextResponse.json({ error: "This slate does not use Golf Salary Cap V1." }, { status: 400 }) };
  }
  const teamId = access.context.team?.id ?? null;
  if (!teamId) {
    return { response: NextResponse.json({ error: "No active team is available for this Group." }, { status: 409 }) };
  }
  const { data: participant, error } = await supabaseAdmin
    .from("slate_teams")
    .select("team_id")
    .eq("slate_id", slateId)
    .eq("team_id", teamId)
    .eq("is_participating", true)
    .maybeSingle();
  if (error) throw new Error(`Failed to validate Golf participation: ${error.message}`);
  if (!participant) {
    return { response: NextResponse.json({ error: "Your Group team is not participating in this slate." }, { status: 403 }) };
  }
  return { user, access, rules, teamId };
}

export async function GET(request: NextRequest) {
  try {
    const slateId = positiveInteger(request.nextUrl.searchParams.get("slateId"));
    if (!slateId) return NextResponse.json({ error: "A valid slateId is required." }, { status: 400 });
    const authorized = await loadAccess(slateId);
    if ("response" in authorized) return authorized.response;

    const [slateResult, periodsResult, priceSetResult, fieldResult] = await Promise.all([
      supabaseAdmin.from("slates").select("id, display_name, is_locked").eq("id", slateId).single(),
      supabaseAdmin.from("golf_roster_periods").select("id, period_key, revision, opened_at, locked_at, completed_at, lock_reason, evidence_snapshot").eq("slate_id", slateId).order("id"),
      supabaseAdmin.from("golf_salary_price_sets").select("id, status, revision, frozen_at").eq("slate_id", slateId).maybeSingle(),
      supabaseAdmin.from("golf_event_players").select("player_id, status, tee_time, is_amateur, golf_players!inner(display_name, country, country_flag_url, owgr_rank), golf_rounds(round_number, holes_completed)").eq("slate_id", slateId),
    ]);
    const loadError = slateResult.error || periodsResult.error || priceSetResult.error || fieldResult.error;
    if (loadError) throw new Error(`Failed to load Golf Salary Cap board: ${loadError.message}`);

    const expectedKeys: PeriodKey[] = authorized.rules.periodType === "split_after_round_2"
      ? ["opening", "weekend"]
      : ["full_tournament"];
    const periods = (periodsResult.data ?? []) as Array<Record<string, any>>;
    const requestedPeriod = request.nextUrl.searchParams.get("period");
    const periodKey: PeriodKey = isPeriodKey(requestedPeriod) && expectedKeys.includes(requestedPeriod)
      ? requestedPeriod
      : expectedKeys.find(key => periods.some(period => period.period_key === key && period.opened_at && !period.locked_at && !period.completed_at)) ?? expectedKeys[0];
    const period = periods.find(row => row.period_key === periodKey) ?? null;

    const priceSet = priceSetResult.data as Record<string, any> | null;
    let prices: Array<Record<string, any>> = [];
    if (priceSet) {
      const result = await supabaseAdmin.from("golf_salary_prices")
        .select("player_id, effective_salary, is_amateur, value_basis")
        .eq("price_set_id", priceSet.id);
      if (result.error) throw new Error(`Failed to load frozen Golf prices: ${result.error.message}`);
      prices = result.data ?? [];
    }
    const priceByPlayer = new Map(prices.map(row => [Number(row.player_id), row]));

    const eligibleWeekendIds = new Set<number>();
    const evidence = objectValue(period?.evidence_snapshot);
    if (Array.isArray(evidence?.players)) {
      for (const raw of evidence.players) {
        const player = objectValue(raw);
        const id = positiveInteger(player?.playerId);
        if (id && (player?.eligibility === "made_cut" || player?.eligibility === "continuing")) eligibleWeekendIds.add(id);
      }
    }

    const openingStarted = (fieldResult.data ?? []).some((row: any) =>
      (row.golf_rounds ?? []).some((round: any) => Number(round.round_number) === 1 && Number(round.holes_completed) > 0));
    const weekendStarted = (fieldResult.data ?? []).some((row: any) =>
      (row.golf_rounds ?? []).some((round: any) => Number(round.round_number) >= 3 && Number(round.holes_completed) > 0));
    const hasStarted = periodKey === "weekend" ? weekendStarted : openingStarted;
    const legacyOpeningLock = periodKey !== "weekend" && Boolean(slateResult.data.is_locked);
    const deadlineExpired = typeof evidence?.acquisitionDeadline === "string" &&
      Date.parse(evidence.acquisitionDeadline) <= Date.now();
    const lifecycleState = !period?.opened_at
      ? "unavailable"
      : period.locked_at || period.completed_at || hasStarted || legacyOpeningLock || deadlineExpired
        ? "locked"
        : "open";

    const lineupResult = period
      ? await supabaseAdmin.from("golf_salary_cap_lineups")
          .select("id, revision, total_salary, golf_salary_cap_lineup_players(player_id, effective_salary)")
          .eq("slate_id", slateId).eq("period_id", period.id).eq("team_id", authorized.teamId).maybeSingle()
      : { data: null, error: null };
    if (lineupResult.error) throw new Error(`Failed to load saved Golf lineup: ${lineupResult.error.message}`);
    const lineup = lineupResult.data as Record<string, any> | null;

    const board = (fieldResult.data ?? []).map((row: any) => {
      const playerId = Number(row.player_id);
      const player = Array.isArray(row.golf_players) ? row.golf_players[0] : row.golf_players;
      const price = priceByPlayer.get(playerId);
      return {
        playerId,
        name: player?.display_name ?? `Golfer ${playerId}`,
        country: player?.country ?? null,
        countryFlagUrl: player?.country_flag_url ?? null,
        owgrRank: player?.owgr_rank === null || player?.owgr_rank === undefined ? null : Number(player.owgr_rank),
        fieldStatus: row.status ?? null,
        teeTime: row.tee_time ?? null,
        isAmateur: Boolean(row.is_amateur ?? price?.is_amateur),
        effectiveSalary: priceSet?.status === "frozen" && price?.effective_salary !== null && price?.effective_salary !== undefined
          ? Number(price.effective_salary) : null,
        priced: priceSet?.status === "frozen" && price?.effective_salary !== null && price?.effective_salary !== undefined,
        eligible: periodKey === "weekend" ? eligibleWeekendIds.has(playerId) : true,
      };
    }).sort((a, b) => (b.effectiveSalary ?? -1) - (a.effectiveSalary ?? -1) || a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      slate: { id: slateId, name: slateResult.data.display_name ?? "Golf tournament" },
      period: { key: periodKey, state: lifecycleState, lockReason: period?.lock_reason ?? null },
      periods: expectedKeys.map(key => {
        const row = periods.find(candidate => candidate.period_key === key);
        return { key, state: !row?.opened_at ? "unavailable" : row.locked_at || row.completed_at ? "locked" : "open" };
      }),
      priceSet: priceSet ? { id: Number(priceSet.id), status: priceSet.status, revision: Number(priceSet.revision), frozenAt: priceSet.frozen_at } : null,
      budget: authorized.rules.budget,
      rosterSize: authorized.rules.rosterSize,
      teamId: authorized.teamId,
      golfers: board,
      lineup: lineup ? {
        revision: Number(lineup.revision),
        totalSalary: Number(lineup.total_salary),
        playerIds: (lineup.golf_salary_cap_lineup_players ?? []).map((row: any) => Number(row.player_id)),
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load Golf Salary Cap." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const slateId = positiveInteger(body.slateId);
    const period = body.period;
    const playerIds = Array.isArray(body.playerIds) ? body.playerIds.map(positiveInteger) : [];
    if (!slateId || !isPeriodKey(period) || playerIds.some(id => id === null)) {
      return NextResponse.json({ error: "Valid slateId, period, and playerIds are required." }, { status: 400 });
    }
    const authorized = await loadAccess(slateId);
    if ("response" in authorized) return authorized.response;
    const expectedRevision = body.expectedRevision === null || body.expectedRevision === undefined
      ? null : Number(body.expectedRevision);
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      return NextResponse.json({ error: "Invalid lineup revision." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc("save_golf_salary_cap_lineup", {
      p_slate: slateId,
      p_group: authorized.access.context.group.id,
      p_league: authorized.access.league.id,
      p_team: authorized.teamId,
      p_actor: authorized.user.id,
      p_period: period,
      p_expected_lineup_revision: expectedRevision,
      p_player_ids: playerIds,
    });
    if (error) {
      const conflict = /revision conflict|changed; refresh/i.test(error.message);
      return NextResponse.json({ error: error.message }, { status: conflict ? 409 : 400 });
    }
    return NextResponse.json({ success: true, lineup: data });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save Golf Salary Cap lineup." }, { status: 500 });
  }
}
