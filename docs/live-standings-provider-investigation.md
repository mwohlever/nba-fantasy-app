# Real-world Live standings: provider investigation

Inspected on 2026-10-02, before implementation. Clean base: `main`,
`add0bf0046398f1227e4734ee145c1de53e6b6fd`. NBA/NFL have inline URL-owned
Game Centers. NCAA Scores still uses its existing modal. No Golf work.

## ESPN endpoints and identity

- NBA: `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?seasontype=2&sort=winpercent:desc`
- NFL: `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=1&level=3`
- NCAA FBS: `https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&seasontype=2&sort=leaguewinpercent:desc,winpercent:desc`
- NCAA polls: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings`
- Historical CFP proof: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings?seasons=2025&seasontypes=2&weeks=16`
- Core CFP proof: `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2025/types/2/weeks/16/rankings/21` and `/22`.

Standings root `season.year` and `season.displayName` identify the current league
season. NBA currently reports 2027 / 2026-27, with zero regular-season records.
NBA's unqualified endpoint defaults to preseason: always request `seasontype=2`.
NFL/NCAA currently report 2026. Historical standings accept `season=YYYY`.
Live standings do not consume Games dates/weeks, fantasy slates, or Skins seasons.

## NBA decision

`children[].standings.entries[]` contains 15 teams per conference. Team identity
and logos come from `team`. Stats include wins, losses, winPercent, gamesBehind,
overall (`type=total`), streak and record splits. Explicit provider percentage
sort is needed: default order is not conference standings order.

The only rank-like field found in regular/expanded/division payloads is
`playoffSeed`, described as "Projected seed in the NBA Playoffs, according to
BPI". Historical seed order also differs from regular-season percentage order
after play-in games. No verified conference rank was found. Implement East/West
records without claiming official ranks; preserve a Playoffs view with an
unavailable explanation. Never turn row indexes into official seeds.

## NFL decision

`level=3` returns conference -> division -> standings.entries. `type=1` identifies
the table as playoff standings and supplies `conferenceRank`, `divisionRank`,
and provider tiebreak descriptions (`conferenceRankReason`, `divisionRankReason`).
Use those ranks directly, with complete unique ranks required before showing a
playoff picture. Validate that conference positions 1-4 are the four supplied
division leaders. Do not compute ties ourselves.

Stats have duplicate names with distinct types: e.g. wins/`wins` and
wins/`total_wins`. Prefer the overall `total_*` type, then the exact base type.
Clincher's `description` supplies its meaning: historical y = Clinched Wild
Card, z = Clinched Division, * = Clinched Division and Bye, e = Eliminated from
Playoff Contention. Render supplied descriptions; no symbol mapping guesses.

## NCAA discovery and independent decisions

1. AP: poll `type=ap`, id 1, name AP Top 25. `ranks[].current` is the rank;
   `recordSummary` is the poll-date overall record. Team includes logo and
   `groups.id/shortName` conference membership. Preserve ties in supplied ranks.
2. Coaches: `type=usa`, id 2. Never substitute this for AP.
3. Current identity: polls expose `latestSeason`, `requestedSeason`, and each
   poll's `season.year`. Validate polls against current standings season.
4. FBS standings: root group 80 exposes actual conference IDs/names. Current
   response includes American, ACC, Big 12, Big Ten, CUSA, Independents, MAC,
   Mountain West, Pac-12, SEC and Sun Belt. Sun Belt currently has East/West
   children; others do not. Render the returned structure, not old divisions.
5. Records: exact stat type `total` supplies overall; `vsconf` supplies conference
   record. There are many duplicate names for other record splits. Request
   provider `sort=leaguewinpercent:desc,winpercent:desc` and preserve returned row
   order, including ties. No local conference tiebreaker or results aggregation.
6. CFP rankings: poll id 21, `type=cfp`, Playoff Committee Rankings. Historical
   2025 week 16 response contains 25 ordered rows.
7. Official CFP field: id 22, `type=tournament`, exact name College Football
   Playoff Seedings. Historical 2025 week 16 has 12 unique official seeds in
   `ranks[].current`; this is distinct from the committee ranking. Implement a
   seeded field only for this explicitly identified same-season poll.
8. Current week 5 contains neither CFP poll. A clean not-yet-released state is
   required. No AP Top 12 projection and no fallback to last year's field.
9. `availableRankings[]` advertises each available poll's week and seasonType.
   In postseason the default response can contain only AP/Coaches while still
   advertising CFP polls. Fetch the advertised current-season CFP week using
   `seasons`, `seasontypes`, `weeks` (all plural). Singular season/week parameters
   can be ignored by the provider. Validate the returned poll year, not just URL.
10. Official bracket: rankings/seedings contain no verified matchup edges or
    bracket positions. Postseason scoreboard mixes CFP and other bowls (already
    documented in lib/providers/ncaa.ts). Implement rankings and official seeded
    field, not an invented bracket. Do not touch the separate bracket challenge.

## Baseline validation

Before edits: TypeScript passes. Full Node suite: 1190 tests, 1164 pass, 23 skip,
3 failures. Failures are Golf mobile-navigation source extraction (unexpected
`!`), NFL background-scoring Thursday/Monday lock expectation, and NFL PlayerPool
season-stat expectation. Standings changes must not be blamed for these baselines.
