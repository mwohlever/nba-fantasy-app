import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Slate = {
  id: number;
  sport: string;
  is_locked: boolean;
  archived_at?: string | null;
  date?: string | null;
  end_date?: string | null;
};

export const staleParticipantNotice =
  "A former Group member is still attached to this slate. Participant changes require review or recreating the unused slate.";

/** Call only after authorizing the slate. Never reconcile history during a read. */
export async function loadSlateParticipantState(slate: Slate) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const endDate = slate.end_date ?? slate.date;
  if (slate.is_locked || slate.archived_at || (endDate && endDate < today)) {
    return {
      editable: false,
      notice: "Participants are read-only for completed or archived slates.",
    };
  }

  const tables = ["lineups", "team_slate_results"];
  if (slate.sport === "nba" || slate.sport === "nfl") {
    tables.push("fantasy_drafts", "draft_picks", "draft_corrections");
  }
  if (slate.sport === "golf") {
    tables.push("golf_salary_cap_lineups", "golf_snake_period_lineups");
  }
  const records = await Promise.all(tables.map((table) =>
    supabaseAdmin.from(table).select("slate_id").eq("slate_id", slate.id).limit(1),
  ));
  for (let index = 0; index < records.length; index++) {
    const error = records[index].error;
    if (error) {
      throw new Error(`Failed to check slate participation (${tables[index]}): ${error.message}`);
    }
  }
  if (records.some((result) => (result.data?.length ?? 0) > 0)) {
    return {
      editable: false,
      notice: slate.sport === "nba" || slate.sport === "nfl"
        ? "Participants are locked after drafting begins."
        : "Participants are locked once this slate has roster or result records.",
    };
  }
  return { editable: true, notice: null };
}

export function hasStaleSlateTeams(
  configurations: Array<{ team_id: number }>,
  activeTeamIds: number[],
) {
  const active = new Set(activeTeamIds);
  return configurations.some((row) => !active.has(row.team_id));
}
