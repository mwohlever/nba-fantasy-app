"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import GameCenterModal from "@/components/live-scores/GameCenterModal";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import { nflGameActionLabel, nflTeamCode } from "@/lib/live-scores/nflFantasyGames";

type GameRequest = { sport: "nfl"; eventId: string };
type Context = {
  gamesByTeam: Record<string, LiveScoreGame>;
  openGameCenter: (request: GameRequest) => void;
};
export const NflFantasyGamesContext = createContext<Context | null>(null);

export function NflFantasyGameCenter({ slateId, refreshKey, children }: {
  slateId: number | null;
  refreshKey: string | null;
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState<{ slateId: number; games: Record<string, LiveScoreGame> } | null>(null);
  const gamesByTeam = loaded?.slateId === slateId ? loaded.games : {};
  const [selectedGame, setSelectedGame] = useState<{ slateId: number; game: LiveScoreGame } | null>(null);

  useEffect(() => setSelectedGame(null), [slateId]);

  useEffect(() => {
    if (!slateId) return;
    const controller = new AbortController();
    void fetch(`/api/lineups/nfl-games?slateId=${slateId}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Games unavailable");
      const data = await response.json();
      if (!controller.signal.aborted && data.slateId === slateId) {
        setLoaded({ slateId, games: data.gamesByTeam ?? {} });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded(null);
    });
    return () => controller.abort();
  }, [slateId, refreshKey]);

  function openGameCenter({ sport, eventId }: GameRequest) {
    if (sport !== "nfl") return;
    const game = Object.values(gamesByTeam).find((candidate) => candidate.espnEventId === eventId);
    if (game && slateId) setSelectedGame({ slateId, game });
  }

  return (
    <NflFantasyGamesContext.Provider value={slateId ? { gamesByTeam, openGameCenter } : null}>
      {children}
      {selectedGame && selectedGame.slateId === slateId ? <GameCenterModal
        key={selectedGame.game.espnEventId}
        apiBase="/api/live-scores/nfl"
        game={selectedGame.game}
        onClose={() => setSelectedGame(null)}
      /> : null}
    </NflFantasyGamesContext.Provider>
  );
}

export function NflFantasyGameAction({ player }: {
  player: { name: string; team_abbreviation?: string | null } | null;
}) {
  const context = useContext(NflFantasyGamesContext);
  const game = player ? context?.gamesByTeam[nflTeamCode(player.team_abbreviation)] : null;
  const label = game ? nflGameActionLabel(game.status) : null;
  if (!game || !label || !context) return null;
  return <button type="button"
    className="px-2 py-1 text-[11px] font-semibold text-sky-700 hover:underline"
    aria-label={`${label}: ${player?.name}`}
    onClick={(event) => {
      event.stopPropagation();
      context.openGameCenter({ sport: "nfl", eventId: game.espnEventId });
    }}
  >{label}</button>;
}

// Preserve the existing slot DOM/layout outside NFL and when no action exists.
export function NflFantasyRosterPlayer({ player, children }: {
  player: { name: string; team_abbreviation?: string | null } | null;
  children: ReactNode;
}) {
  const context = useContext(NflFantasyGamesContext);
  const game = player ? context?.gamesByTeam[nflTeamCode(player.team_abbreviation)] : null;
  if (!game || !nflGameActionLabel(game.status)) return <>{children}</>;
  return <div className="flex min-w-0 flex-col items-center">
    {children}
    <NflFantasyGameAction player={player} />
  </div>;
}
