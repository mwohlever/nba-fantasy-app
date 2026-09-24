import "server-only";

import type { AppUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "./challenge.server";
import { syncClaimedBracketCompetition } from "./backgroundSync.server";

/** Keep the existing active-Group check for the manual route. */
export async function syncBracketOfficialResults(user: AppUser, contestId: string) {
  const detail = await getBracketChallengeDetail(user, contestId);
  if (!detail) return null;
  const outcome = await syncClaimedBracketCompetition(detail.competition.id, true);
  if (outcome.state === "failed") throw new Error(outcome.error);
  if (outcome.state === "leased") return { busy: true };
  if (outcome.state === "backoff") throw new Error("Competition sync is temporarily in backoff.");
  return outcome.result;
}
