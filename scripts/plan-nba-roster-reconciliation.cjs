/* eslint-disable @typescript-eslint/no-require-imports */
// Offline only. No dotenv, network client, database client, SQL generation or apply mode.
const fs = require('node:fs'), crypto = require('node:crypto');
require('./lib/playerCenterRollout.cjs').registerTypescript();
const { planNbaRosterReconciliation } = require('../lib/rosters/nbaReconciliation.ts');
function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args.some(a => a.startsWith('--'))) throw Error('Usage: node scripts/plan-nba-roster-reconciliation.cjs SNAPSHOT.json NEW_REPORT.json');
  const [input, output] = args;
  if (fs.statSync(input).size > 5_000_000 || fs.existsSync(output)) throw Error('Input cap exceeded or output already exists');
  const raw = fs.readFileSync(input, 'utf8');
  const plan = planNbaRosterReconciliation(JSON.parse(raw));
  const report = { ...plan, inputSha256: crypto.createHash('sha256').update(raw).digest('hex') };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}
module.exports = { main };
if (require.main === module) {
  try { console.log(JSON.stringify(main().summary, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
