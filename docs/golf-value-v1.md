# Golf Value V1 — suggested pricing foundation

This produces a golfer-quality index, tournament-relative ranking and **suggested** salary, not projected strokes, fantasy points or win probability. Version: `golf-value-v1-owgr`. No production acquisition, scoring, lifecycle or UI is activated.

## Performance model (unchanged)

`V1 = 0.35 Season + 0.30 Recent + 0.35 Quality`.

For each complete regulation round, differential is same-event/same-round field mean score-to-par minus golfer score-to-par. Positive is better. Finished appearance grades use finish percentile; explicit cuts receive grade 15 without invented rounds. WD/DQ/unknown appearances use actual completed-round performance (`clip(50 + 10 × mean differential)`) at half weight; absent performance has zero weight. DNS contributes nothing.

Season is `(150 + sum(weight × grade))/(3 + sum(weight))`. Recent uses the latest five non-DNS appearances with weights `1, .85, .70, .55, .40`, with the same neutral prior. Quality is `clip(50 + 10 × sum(differential)/(12 + usable rounds))`. Clip means 0–100. These definitions are unchanged. The earlier optional odds branch is retired so performance always uses the locked 35/30/35 formula.

V1 percentile uses midpoint ranks across the entire target field, retaining neutral raw performance for missing-history golfers. Neutral raw performance is **not** sufficient evidence for a price. `value`, `percentile` and `rank` describe performance; `finalValue` and nullable `finalRank` describe the blended quality signal.

## Confidence and OWGR

| Coverage | Required usable appearances AND rounds | V1 / OWGR weights |
|---|---|---|
| High | ≥8 AND ≥20 | 70 / 30 |
| Medium | ≥5 AND ≥12 | 50 / 50 |
| Low | Some usable history below Medium | 30 / 70 |
| No history | No appearance with usable result/performance evidence | 0 / 100 |

Low confidence means sparse coverage, not a bad golfer. Empty WD/DQ observations are not usable appearances. A real explicit cut is usable result evidence even if round cards are absent.

Use existing `golf_players.owgr_rank` / `owgr_updated_at`, joined by ESPN ID to normalized histories. Existing PGA field mapping supplies `owgrRank`; no new provider is needed. Only positive integer OWGR ranks are usable. Lower rank is better. Midpoint OWGR percentiles are calculated **among ranked entrants in this tournament**, not against the world list; missing ranks are not silently placed last. `owgrCoverage` reports the denominator. Singleton/all-tied observed baselines resolve to 50. Rank timestamp is retained, but this pure model does not certify freshness: the future publisher must validate source dates, especially for historical previews.

`Final = V1 weight × V1 percentile + OWGR weight × OWGR percentile`.

Explicit fallbacks:
- V1 only: use V1 percentile; `valueBasis: v1_only`, review required.
- OWGR only: use OWGR percentile; `valueBasis: owgr_only`, review required.
- Neither: `finalValue: null`, `finalRank: null`, `valueBasis: unsupported`; professionals have `pricing.status: unpriced` and `suggestedSalary: null`. Never substitute $22 or zero.

## Salary and amateurs

For Final Value F in 0–100:

```
ordinary = min(39, 15 + 27 × (F / 100)²)
dominance = 3 × clamp((F − 98) / 2, 0, 1)²
suggested salary = round(ordinary + dominance)
```

Normal professional range: **$15–$42**, intended for four golfers/$100. The middle of the original quadratic is preserved. The ordinary curve caps at $39; only the extreme 98–100 interval adds up to $3. This is a simple top-end value premium, not proof of absolute dominance. A weak field can still have a percentile leader. No names or identities influence pricing.

| Final | 100 | 99 | 97 | 95 | 90 | 85 | 80 | 75 | 70 | 60 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Salary | 42 | 40 | 39 | 39 | 37 | 35 | 32 | 30 | 28 | 25 | 22 |

An explicit `isAmateur: true` sets suggested salary to **$10**, including when quality is unsupported. This is an intentional game-design price, not fabricated quality evidence. Value, confidence, scoring and eligibility remain unchanged. `lib/providers/pgaTourField.ts` maps the provider's boolean `amateur` to `isAmateur`; future callers must supply that event-specific designation. Do not infer it from a name, suffix, rank or missing data. ESPN history normalization does not supply this flag automatically. Unknown status receives no amateur discount.

## Inputs and local preview

`valueEspn.ts` normalizes existing ESPN season scoreboard data. Only completed same-season events ending strictly before target start contribute. Target results are never used. Complete 18-hole regulation cards and at least ten valid round participants are required for scoring differentials. Unsupported formats/ambiguous regulation-round structures are skipped. This analytics path never writes accepted live scoring state.

`buildGolfValues` accepts optional `owgrRank`, `owgrUpdatedAt`, and explicit `isAmateur` on each normalized player. The existing local preview accepts an optional third file argument: an array of metadata records keyed by `espn_player_id`, with `owgr_rank`, `owgr_updated_at`, and normalized event-specific `is_amateur`. This is a local interchange shape, not a declaration of database amateur columns. Without metadata it visibly uses V1-only/unpriced fallbacks. It does not fetch or write data.

```
node scripts/preview-golf-values.cjs /tmp/season.json EVENT_ID /tmp/player-metadata.json
```

## Override and freeze contract (future integration)

Outputs are always `priceSetState: draft`. Each player has separate `pricing.suggestedSalary` and `pricing.effectiveSalary: null`; there is deliberately no ambiguous `salary` field. Generation cannot publish a usable effective price. Overrides must not mutate performance or suggested outputs.

Future server-controlled flow: generate → commissioner reviews/overrides → freeze → open acquisition. Store tournament/slate/period identity, exact field and internal golfer IDs, model version, input snapshot/source dates, generated salary, effective salary, override actor/reason/time, and frozen timestamp/revision. Explicit amateurs stay $10 under this rule; future override validation must preserve that exception. Unpriced professionals need manual resolution or explicit unavailability. All participants consume the same frozen effective set; never recalculate prices while users build rosters. Scope/permission checks, freeze persistence and acquisition enforcement are not implemented here. They must integrate with the existing authoritative Golf lifecycle, not replace it.

## Accepted limitations

Sparse PGA coverage and OWGR can both underrepresent LIV/international/selective schedules. Bryson/Cameron Smith-type prices can remain too low even after confidence weighting. Do not add another model/provider for V1; eventual commissioner overrides address obvious errors. Other limits: historical field-strength differences, incomplete ESPN cards/statuses, no injury forecast, multi-course/tee-wave differences, quantity confidence not measuring representativeness, and missing-ranked entrants changing the observed percentile denominator.

This layer has no Standard/Best Ball, Snake/Salary Cap or roster-period branch. Scoring/reconciliation, accepted truth, existing persistence foundations and NBA analytics remain independent. Before production: metadata freshness/identity/coverage validation, price review and immutable freeze, authoritative salary-cap roster validation/locking, and UI. No SQL is required for this pure foundation.
