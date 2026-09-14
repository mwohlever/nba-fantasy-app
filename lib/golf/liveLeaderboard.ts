export type GolfLiveStatusInput = {
  status?: string | null;
  statusState?: string | null;
  statusLabel?: string | null;
  teeTime?: string | null;
  progressHoles?: number | null;
  lastHole?: number | null;
  holesCompleted?: number | null;
};

/** Format accepted Golf state for a compact, golf-native leaderboard row. */
export function formatGolfLiveProgress(input: GolfLiveStatusInput) {
  const rawStatus = String(input.status ?? "").trim().toLowerCase();
  const state = String(input.statusState ?? "").trim().toLowerCase();

  if (/playoff/.test(rawStatus)) return "Playoff";
  if (state === "cut" || rawStatus === "cut") return "CUT";
  if (state === "withdrawn" || rawStatus === "withdrawn") return "WD";
  if (state === "disqualified" || rawStatus === "disqualified") return "DQ";
  if (state === "did_not_start" || rawStatus === "did_not_start") return "DNS";

  if (state === "upcoming") return input.teeTime?.trim() || "Upcoming";

  const hole = Number(
    input.progressHoles ?? input.lastHole ?? input.holesCompleted ?? 0,
  );
  if (state === "playing" && hole > 0 && hole < 18) return `thru ${hole}`;
  if (
    state === "round_complete" ||
    state === "finished" ||
    rawStatus === "finished" ||
    hole === 18
  ) {
    return "F";
  }

  const fallback = input.statusLabel?.trim();
  return fallback && !/thru\s*0/i.test(fallback) ? fallback : "Upcoming";
}
