import { NextRequest, NextResponse } from "next/server";

import { reconcileGolfFieldIdentities } from "@/lib/golf/fieldIdentityReconciliation";
import { parseGolfTournamentByEventIdFromPayload } from "@/lib/providers/golf";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RequestBody = { slateId?: unknown; scoreboardPayload?: unknown; observedAt?: unknown };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RequestBody;
    const slateId = Number(body.slateId);
    if (!Number.isSafeInteger(slateId) || slateId <= 0 || !body.scoreboardPayload) {
      return NextResponse.json({ error: "A valid slateId and ESPN scoreboard payload are required." }, { status: 400 });
    }
    const authorization = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
    if (!authorization.ok) return authorization.response;
    const slate = await supabaseAdmin.from("slates").select("id, sport, external_event_id").eq("id", slateId).single();
    if (slate.error || !slate.data) return NextResponse.json({ error: slate.error?.message ?? "Slate not found." }, { status: 404 });
    if (slate.data.sport !== "golf" || !slate.data.external_event_id) {
      return NextResponse.json({ error: "A Golf slate with an ESPN event identity is required." }, { status: 400 });
    }
    const tournament = parseGolfTournamentByEventIdFromPayload(body.scoreboardPayload, String(slate.data.external_event_id));
    if (!tournament) return NextResponse.json({ error: "ESPN payload does not contain the selected tournament." }, { status: 400 });
    const reconciled = await reconcileGolfFieldIdentities({
      db: supabaseAdmin,
      competitors: tournament.competitors,
      refreshedAt: typeof body.observedAt === "string" && Number.isFinite(Date.parse(body.observedAt)) ? body.observedAt : new Date().toISOString(),
    });
    return NextResponse.json({ success: true, slateId, competitorsFound: tournament.competitors.length, counts: reconciled.counts,
      diagnostics: reconciled.diagnostics });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Golf identity reconciliation failed." }, { status: 500 });
  }
}
