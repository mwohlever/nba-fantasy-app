import fs from "node:fs";
import { gunzipSync } from "node:zlib";

const PGA_KEY =
  process.env.PGA_TOUR_API_KEY ||
  "da2-gsrx5bibzbb4njvhl7t37wqyl4";

const PGA_TOURNAMENT_ID = "R2026027";
const ESPN_EVENT_ID = "401811962";

const TARGET_NAMES = [
  "Patrick Cantlay",
  "Cameron Young",
  "Hideki Matsuyama",
  "Wyndham Clark",
  "Chris Gotterup",
  "Si Woo Kim",
  "Jackson Koivun",
];

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}\n${url}\n${text.slice(0, 1000)}`
    );
  }

  return JSON.parse(text);
}

function decompressPayload(payload) {
  return JSON.parse(
    gunzipSync(
      Buffer.from(payload, "base64"),
    ).toString("utf8"),
  );
}

async function loadEspn() {
  const payload = await fetchJson(
    "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026",
  );

  const event =
    (payload.events ?? []).find(
      (row) => String(row?.id) === ESPN_EVENT_ID,
    ) ?? null;

  if (!event) {
    throw new Error("ESPN St. Jude event not found.");
  }

  const competitors =
    event?.competitions?.[0]?.competitors ?? [];

  return competitors.map((player) => {
    const name = String(
      player?.athlete?.displayName ??
        player?.athlete?.fullName ??
        "",
    ).trim();

    const rounds = Array.isArray(player?.linescores)
      ? player.linescores
      : [];

    return {
      name,
      espnPlayerId: String(
        player?.athlete?.id ?? "",
      ),
      tournamentScore:
        player?.score ?? null,
      rounds: rounds.map((round, index) => {
        const holes = Array.isArray(round?.linescores)
          ? round.linescores
          : [];

        return {
          roundNumber:
            Number(round?.period) || index + 1,
          roundScore:
            round?.displayValue ?? null,
          holes: holes.map((hole, holeIndex) => ({
            holeNumber:
              Number(hole?.period) ||
              holeIndex + 1,
            score:
              Number.isFinite(Number(hole?.value))
                ? Number(hole.value)
                : null,
          })),
        };
      }),
    };
  });
}

async function loadPgaDirectory() {
  const body = await fetchJson(
    "https://data-api.pgatour.com/player/list/R",
    {
      headers: {
        "x-api-key": PGA_KEY,
        Origin: "https://www.pgatour.com",
        Referer: "https://www.pgatour.com/",
      },
    },
  );

  return Array.isArray(body?.players)
    ? body.players.map((p) => ({
        id: String(p?.id ?? "").trim(),
        name: String(
          p?.displayName ??
            `${p?.firstName ?? ""} ${p?.lastName ?? ""}`,
        ).trim(),
      }))
    : [];
}

async function loadPgaRound(
  pgaPlayerId,
  roundNumber,
) {
  const query =
    "query ShotDetailsCompressedV3(" +
    "$tournamentId: ID!, " +
    "$playerId: ID!, " +
    "$round: Int!, " +
    "$includeRadar: Boolean" +
    ") { " +
    "shotDetailsCompressedV3(" +
    "tournamentId: $tournamentId, " +
    "playerId: $playerId, " +
    "round: $round, " +
    "includeRadar: $includeRadar" +
    ") { id payload } }";

  const body = await fetchJson(
    "https://orchestrator.pgatour.com/graphql",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": PGA_KEY,
        Origin: "https://www.pgatour.com",
        Referer: "https://www.pgatour.com/",
      },
      body: JSON.stringify({
        operationName:
          "ShotDetailsCompressedV3",
        query,
        variables: {
          tournamentId: PGA_TOURNAMENT_ID,
          playerId: pgaPlayerId,
          round: roundNumber,
          includeRadar: false,
        },
      }),
    },
  );

  const compressed =
    body?.data
      ?.shotDetailsCompressedV3
      ?.payload;

  if (!compressed) {
    return [];
  }

  const decoded = decompressPayload(compressed);

  return Array.isArray(decoded?.holes)
    ? decoded.holes.map((hole) => ({
        holeNumber:
          Number(hole?.holeNumber) || null,
        score:
          Number.isFinite(Number(hole?.score))
            ? Number(hole.score)
            : null,
        status:
          hole?.status ?? null,
        strokeCount:
          Array.isArray(hole?.strokes)
            ? hole.strokes.length
            : 0,
      }))
    : [];
}

function latestCompletedHole(holes) {
  return holes
    .filter(
      (hole) =>
        Number.isInteger(hole?.holeNumber) &&
        Number.isFinite(hole?.score),
    )
    .reduce(
      (max, hole) =>
        Math.max(max, hole.holeNumber),
      0,
    );
}

const timestamp = new Date();
const stamp = timestamp
  .toISOString()
  .replace(/[:.]/g, "-");

const out =
  `${process.env.HOME}/chatgpt-upload/` +
  `golf-live-latency-${stamp}.txt`;

const espnPlayers = await loadEspn();
const pgaPlayers = await loadPgaDirectory();

let text = "";
text += "============================================================\n";
text += "111 SPORTS — LIVE GOLF SOURCE LATENCY SNAPSHOT\n";
text += `Timestamp UTC: ${timestamp.toISOString()}\n`;
text += `PGA tournament: ${PGA_TOURNAMENT_ID}\n`;
text += `ESPN event: ${ESPN_EVENT_ID}\n`;
text += "============================================================\n";

for (const targetName of TARGET_NAMES) {
  const espn =
    espnPlayers.find(
      (p) =>
        normalizeName(p.name) ===
        normalizeName(targetName),
    ) ?? null;

  const pga =
    pgaPlayers.find(
      (p) =>
        normalizeName(p.name) ===
        normalizeName(targetName),
    ) ?? null;

  text += "\n------------------------------------------------------------\n";
  text += `PLAYER: ${targetName}\n`;
  text += `ESPN ID: ${espn?.espnPlayerId ?? "NOT_FOUND"}\n`;
  text += `PGA ID: ${pga?.id ?? "NOT_FOUND"}\n`;

  if (!espn || !pga) {
    continue;
  }

  const activeRound =
    Math.max(
      1,
      ...espn.rounds.map(
        (round) => round.roundNumber,
      ),
    );

  const espnRound =
    espn.rounds.find(
      (round) =>
        round.roundNumber === activeRound,
    ) ?? null;

  const pgaHoles =
    await loadPgaRound(
      pga.id,
      activeRound,
    );

  const espnHoles =
    espnRound?.holes ?? [];

  const espnThru =
    latestCompletedHole(espnHoles);

  const pgaThru =
    latestCompletedHole(pgaHoles);

  text += `ROUND: ${activeRound}\n`;
  text += `ESPN THRU: ${espnThru}\n`;
  text += `PGA THRU: ${pgaThru}\n`;
  text += `LAG HOLES (PGA - ESPN): ${pgaThru - espnThru}\n`;
  text += `ESPN TOURNAMENT SCORE: ${espn.tournamentScore ?? "—"}\n`;
  text += `ESPN ROUND SCORE: ${espnRound?.roundScore ?? "—"}\n`;

  const maxHole =
    Math.max(espnThru, pgaThru);

  text += "\nHOLE | ESPN | PGA | PGA STATUS | PGA STROKES\n";

  for (
    let holeNumber = 1;
    holeNumber <= maxHole;
    holeNumber++
  ) {
    const espnHole =
      espnHoles.find(
        (h) =>
          h.holeNumber === holeNumber,
      ) ?? null;

    const pgaHole =
      pgaHoles.find(
        (h) =>
          h.holeNumber === holeNumber,
      ) ?? null;

    text += [
      String(holeNumber).padStart(4),
      String(
        espnHole?.score ?? "—",
      ).padStart(4),
      String(
        pgaHole?.score ?? "—",
      ).padStart(3),
      String(
        pgaHole?.status ?? "—",
      ).padStart(12),
      String(
        pgaHole?.strokeCount ?? "—",
      ).padStart(11),
    ].join(" | ");

    text += "\n";
  }
}

fs.writeFileSync(out, text);

console.log("");
console.log("COLLECTOR READY");
console.log(out);
console.log("");
