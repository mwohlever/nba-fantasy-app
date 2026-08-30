"use client";

import { useEffect, useState } from "react";

const NFL_DST_PLAYER_ID_BASE = 100_000_000;

function getNflTeamLogoUrl(
  nflPlayerId: number | string | null | undefined,
) {
  const numericId = Number(nflPlayerId);

  if (
    !Number.isFinite(numericId) ||
    numericId <= NFL_DST_PLAYER_ID_BASE
  ) {
    return null;
  }

  const teamId =
    numericId - NFL_DST_PLAYER_ID_BASE;

  /*
   * Synthetic D/ST ids are:
   *   100_000_000 + ESPN NFL team id
   *
   * Real ESPN athlete ids remain below this range.
   */
  if (
    !Number.isInteger(teamId) ||
    teamId <= 0 ||
    teamId > 100
  ) {
    return null;
  }

  return `https://a.espncdn.com/i/teamlogos/nfl/500/${teamId}.png`;
}


type PlayerHeadshotProps = {
  nbaPlayerId?: number | null;
  nflPlayerId?: number | null;
  espnGolfPlayerId?: string | null;
  imageUrl?: string | null;
  playerName?: string;
  size?: "xs" | "sm" | "md" | "xl";
  className?: string;
};

const sizeClasses = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  xl: "h-20 w-20 sm:h-24 sm:w-24",
};

function getInitials(playerName?: string) {
  if (!playerName) return "?";

  return playerName
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function PlayerHeadshot({
  nbaPlayerId,
  nflPlayerId,
  espnGolfPlayerId,
  imageUrl,
  playerName,
  size = "sm",
  className = "",
}: PlayerHeadshotProps) {

  const nflTeamLogoUrl =
    getNflTeamLogoUrl(
      nflPlayerId,
    );

  const [imageFailed, setImageFailed] = useState(false);

  const resolvedImageUrl =
    nflTeamLogoUrl ??
    (
      imageUrl?.trim() ||
      (nbaPlayerId
        ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`
        : nflPlayerId
          ? `https://a.espncdn.com/i/headshots/nfl/players/full/${nflPlayerId}.png`
          : espnGolfPlayerId
            ? `https://a.espncdn.com/i/headshots/golf/players/full/${espnGolfPlayerId}.png`
            : null)
    );

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedImageUrl]);

  const showImage = Boolean(resolvedImageUrl) && !imageFailed;

  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 ${sizeClasses[size]} ${className}`}
    >
      {showImage ? (
        <img
          src={resolvedImageUrl ?? undefined}
          alt={playerName ?? "Player"}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="text-[10px] font-semibold text-slate-400">
          {getInitials(playerName)}
        </div>
      )}
    </div>
  );
}
