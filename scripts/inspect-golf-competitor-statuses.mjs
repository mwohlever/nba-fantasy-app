const eventId = "401811957";

const url =
  "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026";

const response = await fetch(url, {
  headers: {
    Accept: "application/json",
    "User-Agent": "111-sports-golf-status-inspector/1.0",
  },
});

if (!response.ok) {
  throw new Error(`ESPN request failed: ${response.status}`);
}

const payload = await response.json();

const event = (payload.events ?? []).find(
  (candidate) => String(candidate.id) === eventId
);

if (!event) {
  throw new Error(`Event ${eventId} was not found.`);
}

const competitors =
  event.competitions?.[0]?.competitors ?? [];

console.log("\nSELECTED EVENT:");
console.dir(
  {
    id: event.id,
    name: event.name,
    status: event.status,
    competitorCount: competitors.length,
  },
  { depth: 8 }
);

const summarize = (competitor) => ({
  id: competitor.id,
  name:
    competitor.athlete?.displayName ??
    competitor.athlete?.fullName,
  score: competitor.score,
  order: competitor.order,
  status: competitor.status,
  winner: competitor.winner,
  didNotPlay: competitor.didNotPlay,
  linescoreCount: competitor.linescores?.length ?? 0,
  linescores: competitor.linescores,
});

const statusLikeCompetitors = competitors.filter((competitor) => {
  const text = JSON.stringify(competitor).toLowerCase();

  return (
    text.includes("cut") ||
    text.includes("withdraw") ||
    text.includes("disqual") ||
    text.includes("dns") ||
    text.includes("did not start") ||
    text.includes("didnotplay")
  );
});

console.log("\nSTATUS-LIKE COMPETITORS:");
console.dir(
  statusLikeCompetitors.slice(0, 20).map(summarize),
  { depth: 14 }
);

const fewerThanFourRounds = competitors.filter(
  (competitor) =>
    (competitor.linescores?.length ?? 0) < 4
);

console.log("\nCOMPETITORS WITH FEWER THAN FOUR ROUNDS:");
console.dir(
  fewerThanFourRounds.slice(0, 20).map(summarize),
  { depth: 14 }
);

console.log("\nRAW LAST 15 COMPETITORS:");
console.dir(competitors.slice(-15), { depth: 14 });
