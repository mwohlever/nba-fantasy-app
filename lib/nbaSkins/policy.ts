export function selectNbaSkinsSeasonTeamIds(input: {
  groupTeamIds: number[];
  activeTeamIds: number[];
  referencedTeamIds: number[];
}) {
  const groupTeamIds = new Set(input.groupTeamIds);
  const referenced = [...new Set(input.referencedTeamIds)]
    .filter((teamId) => groupTeamIds.has(teamId));

  return referenced.length > 0
    ? referenced
    : [...new Set(input.activeTeamIds)].filter((teamId) => groupTeamIds.has(teamId));
}

export function validateNbaSkinsDraftOrder(
  teamIds: number[],
  activeTeamIds: number[],
  participantCount: number,
) {
  if (
    teamIds.length !== participantCount ||
    new Set(teamIds).size !== participantCount
  ) return false;
  const active = new Set(activeTeamIds);
  return teamIds.every((teamId) => Number.isInteger(teamId) && active.has(teamId));
}

export function getNbaSkinsTotalPicks(input: {
  participantCount: number;
  nbaTeamsPerParticipant: number;
}) {
  return input.participantCount * input.nbaTeamsPerParticipant;
}

export function isCompleteNbaSkinsDraft(input: {
  pickCount: number;
  participantCount: number;
  nbaTeamsPerParticipant: number;
}) {
  return input.pickCount === getNbaSkinsTotalPicks(input);
}

export function buildNbaSkinsSnakeSlots(
  orderedTeamIds: number[],
  rounds: number,
) {
  const slots: Array<{
    pickNumber: number;
    round: number;
    roundPick: number;
    teamId: number;
  }> = [];

  for (let round = 1; round <= rounds; round += 1) {
    const roundTeamIds = round % 2 === 1
      ? orderedTeamIds
      : [...orderedTeamIds].reverse();
    roundTeamIds.forEach((teamId, index) => slots.push({
      pickNumber: slots.length + 1,
      round,
      roundPick: index + 1,
      teamId,
    }));
  }

  return slots;
}
