import "server-only";

import type { AppUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "./challenge.server";
import { syncBracketCompetitionResults } from "./competitionSync.server";

/** Keep the existing active-Group check for the manual route. */
export async function syncBracketOfficialResults(user: AppUser, contestId: string) {
  const detail = await getBracketChallengeDetail(user, contestId);
  if (!detail) return null;
  return syncBracketCompetitionResults(detail.competition.id);
}
