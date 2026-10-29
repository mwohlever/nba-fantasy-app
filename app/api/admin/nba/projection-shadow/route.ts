import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Retired October 27, 2026. Historical database records are retained. */
export async function GET() {
  return NextResponse.json({ error: "NBA/NFL player projections have been retired.", retired: true }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
