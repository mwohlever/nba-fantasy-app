# NFL V2 model-selection decision

Development finalist locked before holdout: **nfl-v2-o1-opportunity5-production8-v1**. This is research-only, not production.

## Experiment

- Frozen 48-player ESPN cohort; 2023 warmup/history, 2024 development, 2025 untouched holdout.
- Frozen scoring: passing yards 1/25, passing TD 4, interceptions -2, rushing/receiving yards 1/10, rushing/receiving TD 6, receptions 1, fumbles lost -2.
- Only same-player rows earlier than the target game are admitted. D/ST and K are excluded.

## Candidate definitions

- Baseline: scoring-reconstructed mean of five most recent prior games.
- O1: current-season mean last-five opportunity and last-eight ratio-of-totals production.
- O2: current-season last-six opportunity and last-ten production. The first driver below 50% of its preceding-five median (minimum three) gets 25% opportunity influence; consecutive lows get full influence.
- O3: O2 plus exactly one immediately prior-season game when fewer than three current-season games exist; MEDIUM complexity.
- Fumbles lost: total fumbles lost / combined factual opportunity times projected combined opportunity; an unavailable denominator contributes zero, never an invented rate.
- Zero total prior observations abstain. O1/O2 require current-season evidence; O3 permits only its stated bounded support.

## Results

| Model | Complexity | Dev N | Dev MAE | Dev macro MAE | Holdout N | Holdout MAE | Holdout macro MAE |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| nfl-v2-baseline-recent5-fp-v1 | LOW | 436 | 5.173 | 4.937 | 474 | 4.863 | 4.674 |
| nfl-v2-o1-opportunity5-production8-v1 | LOW | 412 | 5.158 | 4.961 | 444 | 4.737 | 4.148 |
| nfl-v2-o2-robust-opportunity6-production10-v1 | LOW | 412 | 5.207 | 5.010 | 444 | 4.807 | 4.203 |
| nfl-v2-o3-robust-opportunity6-production10-prior1game-v1 | MEDIUM | 436 | 5.210 | 4.996 | 473 | 4.987 | 4.735 |

## Selection

Predeclared rule: the direct fantasy-point baseline is must-beat; select the lowest-MAE raw-stat opportunity model only when it beats the baseline. Selected: **nfl-v2-o1-opportunity5-production8-v1**. The development lock is persisted before holdout calculation.

## Findings

- O1 improves development MAE over the baseline, with lower QB and WR error; it has higher RB/TE error and lower coverage because it intentionally abstains without current-season evidence.
- O2 does not improve overall development or holdout MAE, so the selected O1 formula has no robust/partial-game adjustment.
- O3 restores baseline-like coverage with prior-season support but worsens development, holdout, and early-season MAE; the selected O1 formula has no prior-season carryover.
- The selected model is limited to QB/RB/WR/TE and remains research-selected only. It is not connected to production consumers.

## Limitations

- Retrospective ESPN factual data, not a point-in-time availability, injury, or news model.
- No matchup, opponent, weather, lines, snaps, routes, red-zone, or manual-player input.
- Sparse players stay in coverage reporting; output is not an availability forecast.

The machine-readable artifact contains position, early/later, low-opportunity, coverage, and deterministic audits.
