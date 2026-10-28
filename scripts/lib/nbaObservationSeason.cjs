/**
 * ESPN labels NBA seasons by their ending year. Keep the completed season
 * through the offseason, then roll forward on October 1 UTC. The worker keeps
 * fetching this season and its predecessor for new games and stat corrections.
 * An explicit override remains available for reviewed historical acquisitions.
 */
function resolveNbaObservationSeason({ now = new Date(), override } = {}) {
  const value = override?.trim();
  if (!value && (!(now instanceof Date) || !Number.isFinite(now.getTime()))) {
    throw new Error('Valid acquisition date required for NBA season selection');
  }
  const season = value
    ? Number(value)
    : now.getUTCFullYear() + (now.getUTCMonth() >= 9 ? 1 : 0);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new Error('NBA_PROJECTION_SEASON must be an integer from 2000 through 2100');
  }
  return season;
}

module.exports = { resolveNbaObservationSeason };
