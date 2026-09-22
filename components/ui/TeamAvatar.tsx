type TeamAvatarProps = {
  teamName: string;
  avatarUrl?: string | null;
  useLegacyFallback?: boolean;
  size?: "chip" | "xs" | "sm" | "md" | "lg";
};

const sizeMap = {
  chip: "h-5 w-5 text-[8px]",
  xs: "h-6 w-6 text-xs",
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-lg",
};

function getFallbackTeamImage(teamName: string) {
  const normalized = teamName.trim().toLowerCase();

  const map: Record<string, string> = {
    mark: "/team-headshots/mark.webp",
    andy: "/team-headshots/andy.webp",
    jon: "/team-headshots/jon.webp",
    josh: "/team-headshots/josh.webp",
  };

  return map[normalized] ?? "";
}

export default function TeamAvatar({
  teamName,
  avatarUrl,
  useLegacyFallback = true,
  size = "md",
}: TeamAvatarProps) {
  const imageSrc = avatarUrl || (useLegacyFallback ? getFallbackTeamImage(teamName) : "");

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={teamName}
        width={size === "chip" ? 20 : size === "xs" ? 24 : size === "sm" ? 32 : size === "md" ? 40 : 56}
        height={size === "chip" ? 20 : size === "xs" ? 24 : size === "sm" ? 32 : size === "md" ? 40 : 56}
        className={`${sizeMap[size]} rounded-full object-cover ring-2 ring-white shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeMap[size]} flex items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700`}
    >
      {teamName.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}
