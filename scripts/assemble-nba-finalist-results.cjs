/* eslint-disable @typescript-eslint/no-require-imports */
// Combines independently reproducible fixed-finalist split runs into the two
// durable review artifacts. No provider, database, or production writes.
const fs = require('node:fs');
const path = require('node:path');
const ids = ['baseline-weighted10h5', 'nba-v2-blend8h3s0.8-recent15-v1', 'nba-v2-robust50i25-recent15-v1', 'nba-v2-adaptive50i25-recent15-v1'];
if (process.argv.length !== 5) throw new Error('Usage: node scripts/assemble-nba-finalist-results.cjs input-directory data-output-directory docs-output-directory');
const input = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]), docs = path.resolve(process.argv[4]);
const read = (split, id) => JSON.parse(fs.readFileSync(path.join(input, `nba-finalist-${split}-${id}.json`), 'utf8')).splits[split].finalists[0];
const development = ids.map(id => read('development', id));
const holdout = ids.map(id => read('holdout', id));
const selected = 'nba-v2-robust50i25-recent15-v1';
const result = {
  version: 'nba-finalist-evaluation-v1',
  cohort: JSON.parse(fs.readFileSync(path.join(input, `nba-finalist-development-${ids[0]}.json`), 'utf8')).cohort,
  timing: 'retrospective-approximation',
  finalists: ids,
  selectionRule: 'Fixed finalists. Select a LOW-complexity model within 3% of the best development macro-player MAE that passes workload behavior tests. Holdout reports only; it cannot retune selection.',
  selectedModel: selected,
  development,
  holdout,
  limitations: ['Every fifth eligible game is a deterministic chronological target.', 'ESPN history was retrieved retrospectively; this is not verified information-time evidence.', 'The baseline abstains more often, so its metrics have lower coverage and are not a perfect paired comparison.'],
};
fs.writeFileSync(path.join(output, 'nba-finalist-results.json'), JSON.stringify(result, null, 2) + '\n');
const byId = rows => new Map(rows.map(row => [row.id, row]));
const dev = byId(development), hold = byId(holdout), f = value => value == null ? '—' : Number(value).toFixed(3);
const lines = [
  '# NBA projection finalist decision', '',
  'Recommendation: **`nba-v2-robust50i25-recent15-v1`** for a future production shadow trial. It is the simplest finalist that explicitly protects expected minutes after an isolated low-workload appearance.', '',
  'Selection was fixed before holdout: a LOW-complexity model within 3% of best development macro-player MAE wins only if it passes workload behavior tests. The selected robust model was 0.51% behind the development MAE leader; the adaptive version adds role-change switching for no material development or holdout benefit.', '',
  '## Metrics', '',
  '| Model | Complexity | Dev N | Dev MAE | Dev macro MAE | Dev minutes MAE | Holdout N | Holdout MAE | Holdout macro MAE | Holdout minutes MAE |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...ids.map(id => { const d=dev.get(id), h=hold.get(id); return `| ${id} | ${d.complexity} | ${d.metrics.predictions} | ${f(d.metrics.mae)} | ${f(d.metrics.macroPlayerMae)} | ${f(d.metrics.minutes.mae)} | ${h.metrics.predictions} | ${f(h.metrics.mae)} | ${f(h.metrics.macroPlayerMae)} | ${f(h.metrics.minutes.mae)} |`; }), '',
  '## Behavior decision', '',
  '- Robust minutes: weighted last eight appearances, half-life three; a game below half of the preceding-five median gets 25% minute-estimation influence.',
  '- Rates: simple recent-15 ratio of totals. Low-minute games contribute proportionally less; ordinary bad full-minute games remain evidence.',
  '- Three sustained large workload changes are intentionally *not* auto-switched in the selected model. The adaptive finalist was only marginally different and MEDIUM complexity; revisit only if shadow data exposes a practical lag.',
  '- Confidence remains High/Medium/Low from sample/effective support, workload stability, recency, prior fallback, and recent low-workload signal.', '',
  '## Limits', '',
  '- 35-player representative cohort, 6,854 observations, 2023 warmup / 2024 development / 2025 holdout; one unavailable Cam Thomas 2024 ESPN response was excluded.',
  '- Results are retrospective ESPN history, not point-in-time provider revisions. No injury cause, manual expected minutes, opponent adjustment, or availability forecast is claimed.',
  '- The baseline has fewer predictions because it abstains with no usable history; do not overinterpret its raw comparison.', '',
  'The machine-readable companion is `data/analytics/nba-finalist-results.json`.'
];
fs.writeFileSync(path.join(docs, 'nba-projection-finalist-decision.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ selected, output, docs }, null, 2));
