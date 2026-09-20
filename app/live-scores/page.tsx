import AppNav from "@/components/AppNav";
import NflLiveScores from "@/components/live-scores/NflLiveScores";
import NbaLiveScores from "@/components/live-scores/NbaLiveScores";
import { getCurrentUser } from "@/lib/auth";
import { getNflLiveAccess } from "@/lib/live-scores/access";
import { getActiveLeagueForSport } from "@/lib/groups/context";

export default async function LiveScoresPage({ searchParams }: { searchParams: Promise<{ sport?: string | string[] }> }) {
  const params = await searchParams;
  const sport = (Array.isArray(params.sport) ? params.sport[0] : params.sport) === "nba" ? "nba" : "nfl";
  const user = await getCurrentUser();
  const access = user ? sport === "nba" ? await getActiveLeagueForSport(user, "nba") : await getNflLiveAccess(user) : null;
  if (!access) return <main className="p-4 pb-24"><AppNav /><p>{user ? `${sport === "nba" ? "NBA" : "NFL"} is not enabled for this Group.` : "Log in to view Live Scores."}</p></main>;
  return sport === "nba" ? <NbaLiveScores key={`${user!.id}:${access.context.group.id}`} /> : <NflLiveScores key={`${user!.id}:${access.context.group.id}`} />;
}
