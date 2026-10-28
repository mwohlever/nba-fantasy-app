import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PAGE_SIZE = 500;

/** Read the complete NFL catalog; never publish a partially fetched player pool. */
export async function loadNflPlayers<T = Record<string, unknown>>(
  columns: string,
  { activeOnly = false } = {},
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const players: T[] = [];
  let offset = 0;
  try {
    for (;;) {
      let query = supabaseAdmin.from("players_nfl").select(columns);
      if (activeOnly) query = query.eq("is_active", true);
      const { data, error } = await query
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error("Missing player page.");
      if (data.length === 0) return { data: players, error: null };
      players.push(...data as unknown as T[]);
      // Advance by the actual response length: a lower server cap must not skip rows.
      // An empty page, rather than a short page, proves that the catalog is exhausted.
      offset += data.length;
    }
  } catch (error) {
    return {
      data: null,
      error: { message: `Failed to load NFL player catalog at offset ${offset}: ${error instanceof Error ? error.message : "Unknown read error."}` },
    };
  }
}
