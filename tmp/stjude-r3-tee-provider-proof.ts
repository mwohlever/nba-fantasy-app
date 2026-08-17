import {
  fetchPgaTourTeeTimes,
} from "../lib/providers/pgaTourTeeTimes";

async function main() {
  const tournamentUrl =
    "https://www.pgatour.com/tournaments/2026/fedex-st-jude-championship/R2026027/tee-times";

  const players = [
    "Patrick Cantlay",
    "Hideki Matsuyama",
    "Cameron Young",
    "Rory McIlroy",
    "Scottie Scheffler",
    "Ludvig Åberg",
    "Tommy Fleetwood",
    "Matt Fitzpatrick",
    "Justin Thomas",
    "Sam Burns",
    "Xander Schauffele",
    "Collin Morikawa",
  ];

  console.log(
    "============================================================",
  );
  console.log(
    "ST JUDE R3 — EXISTING PGA TEE TIME PROVIDER PROOF",
  );
  console.log(
    "============================================================",
  );
  console.log("URL:", tournamentUrl);
  console.log();

  const rows = await fetchPgaTourTeeTimes(
    { tournamentUrl },
    players,
  );

  const byName = new Map(
    rows.map((row) => [
      row.playerName,
      row.teeTimeRaw,
    ]),
  );

  for (const player of players) {
    console.log(
      `${player} -> ${
        byName.get(player) ?? "NOT FOUND"
      }`,
    );
  }

  console.log();
  console.log("RAW RESULT COUNT:", rows.length);
  console.log();
  console.log("RAW RESULTS:");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error("ERROR:");
  console.error(
    error instanceof Error
      ? error.stack
      : String(error),
  );
  process.exitCode = 1;
});
