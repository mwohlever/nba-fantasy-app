/* eslint-disable @typescript-eslint/no-require-imports */
// Offline JSON in, evaluation JSON on stdout. Never fetches or writes provider/database data.
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { backtestNba, nbaAverageBaseline } = require('../lib/analytics/nba/backtest.ts');
try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/backtest-nba-analytics.cjs /path/to/input.json');
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (!Array.isArray(input.history) || !Array.isArray(input.actuals) || !Array.isArray(input.targets) || !input.policy) {
    throw new Error('Input requires history, actuals, targets and explicit policy');
  }
  const baselines = [
    { kind: 'season-to-date' },
    { kind: 'recent', games: 5 },
    { kind: 'recent', games: 10, halfLifeGames: 5 },
  ];
  console.log(JSON.stringify(baselines.map(options => ({ options,
    ...backtestNba({ ...input, candidate: nbaAverageBaseline(options) }),
  })), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
