"use client";

import { useState } from "react";

type PlayerHeadshotProps = {
  nbaPlayerId?: number | null;
  nflPlayerId?: number | null;
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
  playerName,
  size = "sm",
  className = "",
}: PlayerHeadshotProps) {
  const [imageFailed, setImageFailed] = useState(false);

  const imageUrl = nbaPlayerId
    ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`
    : nflPlayerId
      ? `https://a.espncdn.com/i/headshots/nfl/players/full/${nflPlayerId}.png`
      : null;

  const showImage = imageUrl && !imageFailed;

  return (
    <div
      className={`overflow-hidden rounded-full border border-slate-200 bg-slate-100 flex items-center justify-center ${sizeClasses[size]} ${className}`}
    >
      {showImage ? (
        <img
          src={imageUrl}
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
