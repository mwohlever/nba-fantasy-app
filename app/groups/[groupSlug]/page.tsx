import { notFound, redirect } from "next/navigation";
import GroupLandingPage from "@/components/platform/GroupLandingPage";
import { getCurrentUser } from "@/lib/auth";
import { getGroupContextForUserBySlug } from "@/lib/groups/context";
import { getGroupGameSummaries } from "@/lib/groups/landing";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ groupSlug: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { groupSlug } = await params;
  const context = await getGroupContextForUserBySlug(user, decodeURIComponent(groupSlug));
  if (!context) notFound();
  const games = await getGroupGameSummaries(context);

  return <GroupLandingPage group={context.group} team={context.team} avatarUrl={user.avatarUrl} isGroupAdmin={context.isGroupAdmin} canAdministerGroup={context.canAdministerGroup} games={games} />;
}
