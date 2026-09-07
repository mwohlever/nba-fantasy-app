import { createFootballGameDetailHandler } from "@/lib/live-scores/game-detail";
import { getNflLiveAccess } from "@/lib/live-scores/access";
export const GET = createFootballGameDetailHandler("nfl", getNflLiveAccess);
