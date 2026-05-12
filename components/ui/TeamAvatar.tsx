type TeamAvatarProps = {
  teamName: string;
  size?: "xs" | "sm" | "md" | "lg";
};

const sizeMap = {
  xs: "h-6 w-6 text-xs",
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-lg",
};

function getTeamImage(teamName: string) {
  const normalized = teamName.trim().toLowerCase();

  const map: Record<string, string> = {
    mark: "/team-headshots/mark.jpg",
    andy: "/team-headshots/andy.jpg",
    jon: "/team-headshots/jon.jpg",
    josh: "/team-headshots/josh.jpg",
  };

  return map[normalized] ?? "";
}

export default function TeamAvatar({
  teamName,
  size = "md",
}: TeamAvatarProps) {
  const imageSrc = getTeamImage(teamName);

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={teamName}
        className={`${sizeMap[size]} rounded-full object-cover ring-2 ring-white shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeMap[size]} flex items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700`}
    >
      {teamName.charAt(0).toUpperCase()}
    </div>
  );
}
