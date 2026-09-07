import AppNav from "@/components/AppNav";
import NflLiveScores from "@/components/live-scores/NflLiveScores";
import { getCurrentUser } from "@/lib/auth";
import { getNflLiveAccess } from "@/lib/live-scores/access";
export default async function LiveScoresPage() {
  const user = await getCurrentUser();
  const access = user ? await getNflLiveAccess(user) : null;
  if (!access) return <main className="p-4 pb-24"><AppNav /><p>{user ? "NFL is not enabled for this Group." : "Log in to view Live Scores."}</p></main>;
  return <NflLiveScores key={`${user!.id}:${access.context.group.id}`} />;
}
