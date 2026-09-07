import { createFavoriteHandlers } from "@/lib/live-scores/favorites";
export const { GET, POST, DELETE } = createFavoriteHandlers("ncaa_favorite_teams");
