type EntrantIdentity = {
  id: string;
  entrant_kind: string;
  account_user_id: string | null;
};

/** Managed entrants never borrow the managing account's avatar. */
export async function loadBracketEntrantAvatars(db: any, entrants: EntrantIdentity[]) {
  const accountIds = [...new Set(entrants.flatMap((entrant) =>
    entrant.entrant_kind === "account" && entrant.account_user_id
      ? [entrant.account_user_id]
      : [],
  ))];
  const { data, error } = accountIds.length
    ? await db.from("app_users").select("id, avatar_url").in("id", accountIds)
    : { data: [], error: null };
  if (error) throw new Error(`Failed to load bracket entrant avatars: ${error.message}`);
  const avatarByAccount = new Map<string, string | null>(
    (data ?? []).map((account: { id: string; avatar_url: string | null }) => [account.id, account.avatar_url]),
  );
  return new Map(entrants.map((entrant) => [
    entrant.id,
    entrant.entrant_kind === "account" && entrant.account_user_id
      ? avatarByAccount.get(entrant.account_user_id) ?? null
      : null,
  ]));
}
