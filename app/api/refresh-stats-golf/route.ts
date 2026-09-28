import { NextResponse } from "next/server";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import type { GolfRefreshInput } from "@/lib/golf/refreshSlate.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: GolfRefreshInput & { slateId?: number | string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 }); }
  const slateId = Number(body?.slateId);
  if (!Number.isInteger(slateId) || slateId <= 0)
    return NextResponse.json({ error: "A valid slateId is required." }, { status: 400 });
  const authorization = await authorizeSlateResource(request, slateId, { allowInternal: true });
  if (!authorization.ok) return authorization.response;
  try {
    const { runClaimedGolfSlate } = await import("@/lib/golf/backgroundRefresh.server");
    const outcome = await runClaimedGolfSlate(slateId, body, true);
    if (outcome.response) return outcome.response;
    if (outcome.state === "leased") return NextResponse.json({ error: "Golf refresh is already in progress." }, { status: 409 });
    return NextResponse.json({ error: outcome.error ?? "This Golf slate cannot be refreshed." }, { status: outcome.state === "ineligible" ? 400 : 500 });
  } catch {
    return NextResponse.json({ error: "Golf refresh worker failed." }, { status: 500 });
  }
}
