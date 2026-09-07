import { createFootballGameDetailHandler } from "@/lib/live-scores/game-detail";
import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
export const GET = createFootballGameDetailHandler("college-football", getNcaaPickEmAccess);
