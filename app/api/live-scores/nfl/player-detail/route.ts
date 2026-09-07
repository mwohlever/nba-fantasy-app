import { createFootballPlayerDetailHandler } from "@/lib/live-scores/player-detail";
import { getNflLiveAccess } from "@/lib/live-scores/access";
export const GET = createFootballPlayerDetailHandler("nfl", getNflLiveAccess);
