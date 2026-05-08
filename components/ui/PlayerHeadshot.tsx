type PlayerHeadshotProps = {
  nbaPlayerId?: number | null;
  playerName?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
};

const sizeClasses = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

export default function PlayerHeadshot({
  nbaPlayerId,
  playerName,
  size = "sm",
  className = "",
}: PlayerHeadshotProps) {
  const imageUrl = nbaPlayerId
    ? `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`
    : null;

  return (
    <div
      className={`overflow-hidden rounded-full border border-slate-200 bg-slate-100 flex items-center justify-center ${sizeClasses[size]} ${className}`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={playerName ?? "Player"}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="text-[10px] text-slate-400">NBA</div>
      )}
    </div>
  );
}
