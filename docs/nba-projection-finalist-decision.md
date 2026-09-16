# NBA projection finalist decision

Recommendation: **`nba-v2-robust50i25-recent15-v1`** for a future production shadow trial. It is the simplest finalist that explicitly protects expected minutes after an isolated low-workload appearance.

Selection was fixed before holdout: a LOW-complexity model within 3% of best development macro-player MAE wins only if it passes workload behavior tests. The selected robust model was 0.51% behind the development MAE leader; the adaptive version adds role-change switching for no material development or holdout benefit.

## Metrics

| Model | Complexity | Dev N | Dev MAE | Dev macro MAE | Dev minutes MAE | Holdout N | Holdout MAE | Holdout macro MAE | Holdout minutes MAE |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline-weighted10h5 | LOW | 440 | 8.852 | 9.177 | — | 443 | 8.786 | 8.651 | — |
| nba-v2-blend8h3s0.8-recent15-v1 | LOW | 470 | 8.665 | 9.027 | 3.954 | 474 | 8.753 | 8.670 | 3.710 |
| nba-v2-robust50i25-recent15-v1 | LOW | 470 | 8.707 | 9.073 | 3.988 | 474 | 8.773 | 8.694 | 3.729 |
| nba-v2-adaptive50i25-recent15-v1 | MEDIUM | 470 | 8.724 | 9.089 | 4.019 | 474 | 8.756 | 8.672 | 3.711 |

## Behavior decision

- Robust minutes: weighted last eight appearances, half-life three; a game below half of the preceding-five median gets 25% minute-estimation influence.
- Rates: simple recent-15 ratio of totals. Low-minute games contribute proportionally less; ordinary bad full-minute games remain evidence.
- Three sustained large workload changes are intentionally *not* auto-switched in the selected model. The adaptive finalist was only marginally different and MEDIUM complexity; revisit only if shadow data exposes a practical lag.
- Confidence remains High/Medium/Low from sample/effective support, workload stability, recency, prior fallback, and recent low-workload signal.

## Limits

- 35-player representative cohort, 6,854 observations, 2023 warmup / 2024 development / 2025 holdout; one unavailable Cam Thomas 2024 ESPN response was excluded.
- Results are retrospective ESPN history, not point-in-time provider revisions. No injury cause, manual expected minutes, opponent adjustment, or availability forecast is claimed.
- The baseline has fewer predictions because it abstains with no usable history; do not overinterpret its raw comparison.

The machine-readable companion is `data/analytics/nba-finalist-results.json`.
