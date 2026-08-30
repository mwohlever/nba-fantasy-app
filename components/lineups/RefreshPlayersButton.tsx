

"use client";

type RefreshPlayersButtonProps = {
  sport?: "nba" | "nfl";
};

export default function RefreshPlayersButton({
  sport = "nba",
}: RefreshPlayersButtonProps) {
  async function handleRefreshPlayers() {
    try {
      const endpoint =
        sport === "nfl"
          ? "/api/sync-players-nfl"
          : "/api/sync-players";

      const res = await fetch(endpoint, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to refresh players");
        return;
      }

      const nflDetails =
        data.kickerCount !== undefined ||
        data.defenseCount !== undefined
          ? `\nKickers found: ${data.kickerCount ?? 0}\nDefenses found: ${data.defenseCount ?? 0}`
          : "";

      alert(
        `Players synced! Added: ${data.insertedCount ?? 0}, Updated: ${data.updatedCount ?? 0}${nflDetails}`
      );

      window.location.reload();
    } catch (error) {
      console.error(error);
      alert("Something went wrong while refreshing players.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleRefreshPlayers}
      className="rounded-lg border border-blue-400/30 bg-blue-500/15 px-4 py-2 text-sm text-white hover:bg-blue-500/25"
    >
      Refresh Players
    </button>
  );
}
