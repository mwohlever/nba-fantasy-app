import { createFootballGameDetailHandler } from "@/lib/live-scores/game-detail";
import { getNflLiveAccess } from "@/lib/live-scores/access";
import { loadNflOwnership } from "@/lib/live-scores/nflOwnership.server";
import { normalizeNflField } from "@/lib/live-scores/nflField";

export const GET = createFootballGameDetailHandler("nfl", getNflLiveAccess, async (summary, access, request) => {
  const field = normalizeNflField(summary);
  // The cookie authorizes scope; the explicit client scope prevents switch races.
  if (request.nextUrl.searchParams.get("groupId") !== access.context.group.id) return { field };
  const ownership = await loadNflOwnership(access, summary.header?.competitions?.[0]?.date ?? "")
    .catch(() => null);
  return { field, ownership };
});
