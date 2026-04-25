import { NextRequest, NextResponse } from "next/server";

type ScoreboardGame = {
  gameId?: string;
  gameCode?: string;
  gameStatus?: number;
  gameStatusText?: string;
  gameTimeUTC?: string;
  gameEt?: string;
  homeTeam?: {
    teamName?: string;
    teamTricode?: string;
  };
  awayTeam?: {
    teamName?: string;
    teamTricode?: string;
  };
};

function formatForNbaStats(dateIso: string) {
  const [year, month, day] = dateIso.split("-");
  return `${month}/${day}/${year}`;
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");

  if (!date) {
    return NextResponse.json(
      { error: "Use ?date=YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const formattedDate = formatForNbaStats(date);

  const url = `https://stats.nba.com/stats/scoreboardv3?GameDate=${encodeURIComponent(
    formattedDate
  )}&LeagueID=00`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.nba.com",
      Referer: "https://www.nba.com/",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    cache: "no-store",
  });

  const payload = await response.json();
  const games = payload.scoreboard?.games ?? payload.games ?? [];

  return NextResponse.json({
    success: true,
    date,
    formattedDate,
    gameCount: games.length,
    games: games.map((game: ScoreboardGame) => ({
      gameId: game.gameId,
      gameCode: game.gameCode,
      gameStatus: game.gameStatus,
      gameStatusText: game.gameStatusText,
      gameTimeUTC: game.gameTimeUTC,
      gameEt: game.gameEt,
      awayTeam: game.awayTeam?.teamTricode,
      homeTeam: game.homeTeam?.teamTricode,
    })),
  });
}
