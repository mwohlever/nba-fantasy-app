import fs from "node:fs";

const EVENT_ID = "401811962";

const urls = [
  `https://site.api.espn.com/apis/site/v2/sports/golf/pga/summary?event=${EVENT_ID}`,
  `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026`,
];

const output = [];

for (const url of urls) {
  console.log(`Fetching ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  console.log(`HTTP ${response.status}`);

  const text = await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = {
      parseError: true,
      preview: text.slice(0, 2000),
    };
  }

  output.push({
    url,
    status: response.status,
    json,
  });
}

fs.writeFileSync(
  "tmp/collectors/current-golf-course-espn.json",
  JSON.stringify(output, null, 2),
);

console.log();
console.log("Saved raw ESPN responses.");
