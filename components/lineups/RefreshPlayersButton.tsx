

"use client";

export default function RefreshPlayersButton() {
  async function handleRefreshPlayers() {
    try {
      const res = await fetch("/api/sync-players", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to refresh players");
        return;
      }

      alert(
        `Players synced! Added: ${data.insertedCount ?? 0}, Updated: ${data.updatedCount ?? 0}`
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
