import { createFavoriteHandlers } from "@/lib/live-scores/favorites";
export const { GET, POST, DELETE } = createFavoriteHandlers("live_score_favorite_teams", "nfl");
