/* eslint-disable @typescript-eslint/no-require-imports */
// Offline review of explicit provider snapshots. No clients, credentials, SQL, or apply mode.
const fs = require('node:fs');
const { registerTypescript, hash } = require('./lib/playerCenterRollout.cjs');
registerTypescript();
const { auditNbaAcquisitionIdentities } = require('../lib/player-center/nbaIdentity.ts');
function review(snapshot, now = Date.now()) {
  if (!snapshot.readAt || !Array.isArray(snapshot.players) || !Array.isArray(snapshot.identities) || !Array.isArray(snapshot.native) || !Array.isArray(snapshot.espn)) throw Error('Complete dated identity snapshot required');
  const rows = auditNbaAcquisitionIdentities({ ...snapshot, stored: snapshot.identities });
  const age = now - Date.parse(snapshot.readAt);
  return { snapshotSha256: hash(snapshot), evidenceAt: snapshot.readAt, evidenceFresh: Number.isFinite(age) && age >= 0 && age <= 86400000,
    poolPlayers: rows.length, databaseWrites: 0,
    requiresFreshEvidenceAndManualMappingApproval: true, rows };
}
module.exports = { review };
if (require.main === module) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output || fs.existsSync(output)) throw Error('Usage: node scripts/review-nba-refresh-identities.cjs SNAPSHOT.json NEW_REPORT.json');
  const report = review(JSON.parse(fs.readFileSync(source, 'utf8')));
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ poolPlayers: report.poolPlayers, databaseWrites: 0, output }));
}
