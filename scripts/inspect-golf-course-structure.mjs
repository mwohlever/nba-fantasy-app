const eventId = "401811960";
const url =
  `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${eventId}`;

const response = await fetch(url);

if (!response.ok) {
  throw new Error(`ESPN request failed: ${response.status}`);
}

const json = await response.json();
const event = json?.events?.[0] ?? null;
const competition = event?.competitions?.[0] ?? null;
const firstCompetitor = competition?.competitors?.[0] ?? null;

function printSection(label, value) {
  console.log("\n============================================================");
  console.log(label);
  console.log("============================================================");
  console.log(JSON.stringify(value, null, 2));
}

function collectReferences(
  value,
  path = "$",
  results = [],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectReferences(item, `${path}[${index}]`, results),
    );
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    const normalizedKey = key.toLowerCase();

    if (
      typeof child === "string" &&
      (
        normalizedKey === "$ref" ||
        normalizedKey.includes("href") ||
        normalizedKey.includes("url") ||
        child.startsWith("http")
      )
    ) {
      results.push({
        path: nextPath,
        value: child,
      });
    }

    collectReferences(child, nextPath, results);
  }

  return results;
}

function collectRelevantObjects(
  value,
  path = "$",
  results = [],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectRelevantObjects(item, `${path}[${index}]`, results),
    );
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    const normalizedKey = key.toLowerCase();

    if (
      normalizedKey.includes("course") ||
      normalizedKey.includes("venue") ||
      normalizedKey.includes("hole") ||
      normalizedKey === "par" ||
      normalizedKey.includes("yardage")
    ) {
      results.push({
        path: nextPath,
        value: child,
      });
    }

    collectRelevantObjects(child, nextPath, results);
  }

  return results;
}

printSection("EVENT KEYS", Object.keys(event ?? {}));
printSection(
  "COMPETITION KEYS",
  Object.keys(competition ?? {}),
);
printSection("EVENT VENUE", event?.venue ?? null);
printSection(
  "COMPETITION VENUE",
  competition?.venue ?? null,
);
printSection(
  "COMPETITION COURSE",
  competition?.course ?? null,
);
printSection(
  "FIRST COMPETITOR KEYS",
  Object.keys(firstCompetitor ?? {}),
);
printSection(
  "FIRST COMPETITOR LINESCORES",
  firstCompetitor?.linescores ?? null,
);
printSection(
  "FIRST COMPETITOR STATISTICS",
  firstCompetitor?.statistics ?? null,
);
printSection(
  "ALL REFERENCES",
  collectReferences(json),
);
printSection(
  "COURSE / VENUE / HOLE / PAR OBJECTS",
  collectRelevantObjects(json).slice(0, 300),
);
