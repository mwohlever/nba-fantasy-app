import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ResourceAuthorization } from "@/lib/security/resourceAuthorization";

type AuthorizedSlate = Extract<ResourceAuthorization, { ok: true }>;

export type SlateDiscardEligibility = {
  eligible: boolean;
  code: string;
  reason: string | null;
};

export function slateDiscardArguments(authorization: AuthorizedSlate) {
  return {
    p_slate_id: authorization.target.id,
    p_group_id: authorization.target.groupId,
    p_league_id: authorization.target.leagueId,
    p_actor_id: authorization.user!.id,
  };
}

export async function inspectSlateDiscard(
  authorization: AuthorizedSlate,
): Promise<SlateDiscardEligibility> {
  if (authorization.target.sportKey !== "nfl") {
    return { eligible: false, code: "unsupported_sport", reason: "Discard is available only for pre-game NFL slates." };
  }
  const { data, error } = await supabaseAdmin.rpc(
    "inspect_nfl_slate_discard",
    slateDiscardArguments(authorization),
  );
  // Preserve ordinary Slate Admin reads before the manual migration is applied.
  // Unknown/missing infrastructure must never enable destructive controls.
  if (error || !data || typeof data.eligible !== "boolean") {
    return { eligible: false, code: "unavailable", reason: "Slate discard is unavailable. Apply the reviewed migration before using this action." };
  }
  return data as SlateDiscardEligibility;
}
