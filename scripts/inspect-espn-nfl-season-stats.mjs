const season =
  process.argv[2] ??
  "2025";

const athleteId =
  process.argv[3] ??
  "3139477"; // example ESPN athlete ID

const urls = [
  `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${athleteId}/stats?region=us&lang=en&contentorigin=espn&showAirings=true&season=${season}`,
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/${athleteId}/statistics?season=${season}`,
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/athletes/${athleteId}/statistics`,
];

for (const url of urls) {
  console.log();
  console.log("==================================================");
  console.log(url);
  console.log("==================================================");

  try {
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

    console.log(
      "STATUS:",
      response.status,
    );

    const text =
      await response.text();

    if (
      !response.ok
    ) {
      console.log(
        text.slice(
          0,
          500,
        ),
      );

      continue;
    }

    try {
      const data =
        JSON.parse(
          text,
        );

      console.log(
        JSON.stringify(
          data,
          null,
          2,
        ).slice(
          0,
          12000,
        ),
      );
    } catch {
      console.log(
        text.slice(
          0,
          12000,
        ),
      );
    }
  } catch (
    error
  ) {
    console.error(
      error,
    );
  }
}
