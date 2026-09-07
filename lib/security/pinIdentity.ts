import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Identity entry replaces the public login directory. Names are only compared
// within an explicitly named Group; credentials are still verified by callers.
export async function resolvePinAccountId(input: {
  groupSlug?: unknown;
  teamName?: unknown;
  legacyTeamId?: unknown;
}): Promise<string | null> {
  const groupSlug = String(input.groupSlug ?? "").trim().toLowerCase();
  const teamName = String(input.teamName ?? "").trim();
  if (groupSlug || teamName) {
    if (!groupSlug || !teamName || groupSlug.length > 100 || teamName.length > 200) return null;
    const { data: group, error: groupError } = await supabaseAdmin
      .from("groups").select("id").eq("slug", groupSlug).eq("is_active", true).maybeSingle();
    if (groupError) throw new Error("Unable to resolve PIN identity.");
    if (!group) return null;
    const { data: team, error: teamError } = await supabaseAdmin
      .from("teams").select("user_id").eq("group_id", group.id).eq("name", teamName).maybeSingle();
    if (teamError) throw new Error("Unable to resolve PIN identity.");
    if (!team?.user_id) return null;
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("group_memberships").select("user_id").eq("group_id", group.id)
      .eq("user_id", team.user_id).eq("is_active", true).maybeSingle();
    if (membershipError) throw new Error("Unable to resolve PIN identity.");
    return membership ? String(team.user_id) : null;
  }

  // Preserve existing ID-based PIN and account-link clients. app_users.team_id
  // is a legacy login reference, never the current Group's fantasy team identity.
  const teamId = Number(input.legacyTeamId);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return null;
  const { data, error } = await supabaseAdmin.from("app_users")
    .select("id").eq("team_id", teamId).maybeSingle();
  if (error) throw new Error("Unable to resolve PIN identity.");
  return data ? String(data.id) : null;
}
