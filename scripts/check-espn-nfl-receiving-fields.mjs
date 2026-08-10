const season =
  process.argv[2] ??
  "2025";

const athleteId =
  process.argv[3] ??
  "3139477";

const url =
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/athletes/${athleteId}/statistics`;

const response =
  await fetch(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0",
      },
    },
  );

if (!response.ok) {
  throw new Error(
    `ESPN returned ${response.status}`
  );
}

const data =
  await response.json();

for (
  const category
  of data?.splits?.categories ??
    []
) {
  console.log();
  console.log(
    `=== ${category.name} ===`
  );

  for (
    const stat
    of category.stats ??
      []
  ) {
    const haystack =
      [
        stat.name,
        stat.displayName,
        stat.shortDisplayName,
        stat.abbreviation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (
      haystack.includes(
        "target",
      ) ||
      haystack.includes(
        "recept",
      ) ||
      category.name ===
        "receiving"
    ) {
      console.log({
        name:
          stat.name,
        displayName:
          stat.displayName,
        abbreviation:
          stat.abbreviation,
        value:
          stat.value,
        perGameValue:
          stat.perGameValue,
      });
    }
  }
}
