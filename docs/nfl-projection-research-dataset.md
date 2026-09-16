# NFL V2 historical research dataset

This is a local factual-preparation artifact for future NFL V2 model selection. It is not production infrastructure, does not access Supabase, does not alter NFL UI/scoring, and does not select a model.

## Scope

Initial NFL V2 scope is **QB / RB / WR / TE**. There are no NFL V2 projections or historical research rows for **D/ST / K**, and no fake fallback projection.

## Source and seasons

ESPN athlete logs: `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/gamelog?season={year}`. The dataset keeps only ESPN `splitType: "2"` regular-season events from 2023–2025. A valid provider no-history response remains a no-history result; no zero-week observations are invented.

## Cohort and fields

[`data/analytics/nfl-research-cohort.json`](/home/markwohlever/nba-fantasy-app/data/analytics/nfl-research-cohort.json) freezes 12 ESPN IDs per supported position. The discovery script deduplicates roster athletes, numerically sorts IDs within position, divides them into 12 equal index bands, and selects each band's first athlete. The frozen manifest—not a new roster lookup—is the cohort for repeat runs. This avoids a stars-only sample while keeping acquisition modest.

Rows preserve player/event/team/opponent identity, season/week/date/home-away, and raw passing, rushing, receiving, and fumble-loss fields. Missing provider fields stay `null`; they never become zero. Expected opportunity, robust flags, confidence, forecasts, and fantasy-point projections are intentionally absent.

ESPN QB game logs do not expose `fumblesLost`, so QB values are enriched from the ESPN event summary endpoint. [`nfl-research-qb-fumble-summaries.json`](/home/markwohlever/nba-fantasy-app/data/analytics/nfl-research-qb-fumble-summaries.json) is a compact, normalized event cache keyed by provider event ID. It validates summary identity, the player boxscore structure, a `fumbles` group, and `FUM`/`LOST` labels before joining athlete IDs to QB observations. A QB absent from a fully validated fumbles group is factual zero; an invalid/missing summary is never converted to zero.

## Reproduction

```bash
node scripts/fetch-nfl-research-game-logs.cjs /tmp/nfl-research-cache
node scripts/fetch-nfl-research-qb-fumbles.cjs /tmp/nfl-research-cache data/analytics
node scripts/prepare-nfl-research-dataset.cjs /tmp/nfl-research-cache data/analytics
```

The fetchers perform only ESPN GETs and cache raw envelopes in `/tmp`; the QB fumble fetcher writes the compact normalized evidence cache, while the offline assembler writes the gzip dataset, manifest, and validation report. Parser and cohort tests are in [`tests/nfl-research-dataset.test.cjs`](/home/markwohlever/nba-fantasy-app/tests/nfl-research-dataset.test.cjs).

## Known limitations

This is a deliberately small, frozen research cohort rather than a league-wide historical corpus. It is limited to ESPN's normalized factual game-log and QB event-summary evidence for 2023–2025 regular-season games; it does not add projections for D/ST or K, postseason rows, injury context, or any selected model or forecast output.

No NFL V2 model has been selected yet. The next phase may compare a small, predeclared candidate set using these factual observations.
