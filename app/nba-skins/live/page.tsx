import AppNav from "@/components/AppNav";
import NbaLiveScores from "@/components/live-scores/NbaLiveScores";
import { getCurrentUser } from "@/lib/auth";
import { getNbaLiveAccess } from "@/lib/live-scores/access";

export default async function NbaSkinsLivePage() {
  const user = await getCurrentUser();
  const access = user ? await getNbaLiveAccess(user, "nba-skins") : null;
  if (!access) return <main className="p-4 pb-24"><AppNav /><p>{user ? "NBA Skins is not enabled for this Group." : "Log in to view Live Scores."}</p></main>;
  // Live uses NBA schedule dates, leaving remembered Skins seasons untouched.
  return <NbaLiveScores key={`${user!.id}:${access.context.group.id}`} context="nba-skins" />;
}
