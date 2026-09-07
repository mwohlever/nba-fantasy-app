import { createFootballPlayerDetailHandler } from "@/lib/live-scores/player-detail";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
export const GET = createFootballPlayerDetailHandler("college-football", getNcaaPickEmAccess);
