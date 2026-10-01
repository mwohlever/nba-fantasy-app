import { NextResponse } from "next/server";
import { isFantasySport } from "@/lib/lineups/draftContext";

/** Call only after resource authorization. Omission preserves legacy callers. */
export function validateExpectedSlateSport(
  expected: unknown,
  actual: unknown,
  leagueSport: unknown = actual,
) {
  if (expected === null || expected === undefined) return null;
  if (!isFantasySport(expected)) {
    return NextResponse.json({ error: "sport must be nba, nfl, or golf." }, { status: 400 });
  }
  if (actual !== expected || leagueSport !== actual) {
    return NextResponse.json({ error: "Slate not found for the requested sport." }, { status: 404 });
  }
  return null;
}
