import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function fetchTeamsForDate(date: string) {
  const formatted = new Date(date);
  const mm = String(formatted.getMonth() + 1).padStart(2, "0");
  const dd = String(formatted.getDate()).padStart(2, "0");
  const yyyy = formatted.getFullYear();

  const url = `https://stats.nba.com/stats/scoreboardv3?GameDate=${mm}/${dd}/${yyyy}&LeagueID=00`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.nba.com/",
    },
    cache: "no-store",
  });

  const json = await res.json();

  const games = json?.scoreboard?.games ?? [];

  const teams = new Set<string>();

  for (const g of games) {
    if (g.homeTeam?.teamTricode) teams.add(g.homeTeam.teamTricode);
    if (g.awayTeam?.teamTricode) teams.add(g.awayTeam.teamTricode);
  }

  return Array.from(teams);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { startDate, endDate } = body;

  // 🔥 AUTO FETCH NBA TEAMS
  let nbaTeams: string[] = [];

  try {
    nbaTeams = await fetchTeamsForDate(startDate);
  } catch (e) {
    console.error("NBA fetch failed, fallback empty");
  }

  const { data: slate } = await supabaseAdmin
    .from("slates")
    .insert({
      date: startDate,
      start_date: startDate,
      end_date: endDate,
      is_locked: false,
      nba_team_abbreviations: nbaTeams,
    })
    .select()
    .single();

  return NextResponse.json({
    success: true,
    slate,
  });
}
