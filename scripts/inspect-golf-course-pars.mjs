const eventId = "401811960";

const urls = [
  `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=${eventId}`,
  `https://site.web.api.espn.com/apis/fittwo/v3/sports/golf/leaderboard?region=us&lang=en&contentorigin=espn&isqualified=true&event=${eventId}`,
];

function walk(value, path = "$", matches = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, matches));
    return matches;
  }

  if (!value || typeof value !== "object") {
    return matches;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;

    if (
      key.toLowerCase() === "par" ||
      key.toLowerCase().includes("yardage") ||
      key.toLowerCase().includes("course") ||
      key.toLowerCase().includes("hole")
    ) {
      if (
        typeof child === "string" ||
        typeof child === "number" ||
        child === null
      ) {
        matches.push({
          path: nextPath,
          value: child,
        });
      }
    }

    walk(child, nextPath, matches);
  }

  return matches;
}

for (const url of urls) {
  console.log("\n============================================================");
  console.log(url);
  console.log("============================================================");

  const response = await fetch(url);

  console.log("HTTP", response.status);

  if (!response.ok) {
    console.log(await response.text());
    continue;
  }

  const json = await response.json();
  const matches = walk(json);

  for (const match of matches.slice(0, 500)) {
    console.log(`${match.path} = ${JSON.stringify(match.value)}`);
  }
}
