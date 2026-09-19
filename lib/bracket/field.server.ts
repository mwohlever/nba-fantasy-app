import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchNcaaEspnTeamDirectory } from "@/lib/providers/ncaa";
import {
  normalizeCfpField,
  type BracketFieldTeamInput,
} from "@/lib/bracket/field";

export type BracketCompetitionTeam = {
  id: number;
  competitionId: number;
  seed: number;
  provider: string;
  providerTeamId: string;
  displayName: string;
  abbreviation: string | null;
  logoUrl: string | null;
};

export type { BracketFieldTeamInput } from "@/lib/bracket/field";

export async function assertCfpCompetition(competitionId: number) {
  const { data, error } = await supabaseAdmin
    .from("bracket_competitions")
    .select("id, format_key, status")
    .eq("id", competitionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Bracket competition not found.");
  if (data.format_key !== "cfp") {
    throw new Error("This field editor currently supports CFP competitions only.");
  }
  return { status: String(data.status) };
}

export async function getBracketCompetitionField(
  competitionId: number,
): Promise<BracketCompetitionTeam[]> {
  const { data, error } = await supabaseAdmin
    .from("bracket_competition_teams")
    .select(
      "id, competition_id, seed, provider, provider_team_id, display_name, abbreviation, logo_url",
    )
    .eq("competition_id", competitionId)
    .order("seed", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: {
    id: number;
    competition_id: number;
    seed: number;
    provider: string;
    provider_team_id: string;
    display_name: string;
    abbreviation: string | null;
    logo_url: string | null;
  }) => ({
    id: Number(row.id),
    competitionId: Number(row.competition_id),
    seed: Number(row.seed),
    provider: String(row.provider),
    providerTeamId: String(row.provider_team_id),
    displayName: String(row.display_name),
    abbreviation: row.abbreviation ? String(row.abbreviation) : null,
    logoUrl: row.logo_url ? String(row.logo_url) : null,
  }));
}

export async function saveCfpCompetitionField(
  competitionId: number,
  teams: BracketFieldTeamInput[],
) {
  const normalized = normalizeCfpField(teams);
  const directory = await fetchNcaaEspnTeamDirectory();
  const directoryById = new Map(directory.map((team) => [team.id, team]));
  const enriched = normalized.map((team) => {
    const providerTeam = directoryById.get(team.providerTeamId);
    if (!providerTeam) {
      throw new Error(`ESPN college-football team ${team.providerTeamId} is not in the FBS directory.`);
    }

    return {
      ...team,
      displayName: providerTeam.displayName,
      abbreviation: providerTeam.abbreviation,
      logoUrl: providerTeam.logo,
    };
  });

  const { data, error } = await supabaseAdmin.rpc("replace_cfp_competition_field", {
    p_competition_id: competitionId,
    p_teams: enriched.map((team) => ({
      seed: team.seed,
      provider_team_id: team.providerTeamId,
      display_name: team.displayName,
      abbreviation: team.abbreviation ?? null,
      logo_url: team.logoUrl ?? null,
    })),
  });

  if (error) throw new Error(error.message);

  const result = data as { fieldChanged?: boolean; picksClearedCount?: number } | null;
  return {
    field: await getBracketCompetitionField(competitionId),
    fieldChanged: result?.fieldChanged === true,
    picksClearedCount: Number(result?.picksClearedCount ?? 0),
  };
}
