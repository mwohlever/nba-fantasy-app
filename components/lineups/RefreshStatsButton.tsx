"use client";

type Props = {
  slateId: number | null;
};

export default function RefreshStatsButton({ slateId }: Props) {
  async function handleRefreshStats() {
    if (!slateId) {
      alert("No slate selected.");
      return;
    }

    try {
      const res = await fetch("/api/refresh-stats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slateId }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to refresh stats.");
        return;
      }

      alert(
        `Stats refreshed! Games found: ${data.gamesFound ?? 0}, Players updated: ${data.playerStatsUpserted ?? 0}, Teams updated: ${data.teamResultsUpserted ?? 0}`
      );

      window.location.reload();
    } catch (error) {
      console.error(error);
      alert("Something went wrong while refreshing stats.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleRefreshStats}
      disabled={!slateId}
      className="rounded-lg border border-green-400/30 bg-green-500/15 px-4 py-2 text-sm text-white hover:bg-green-500/25 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Refresh Stats
    </button>
  );
}
