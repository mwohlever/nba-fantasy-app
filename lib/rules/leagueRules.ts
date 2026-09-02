export type SlateSport =
  | "nba"
  | "nfl"
  | "golf";


export type DraftType =
  | "snake"
  | "linear";


export type RosterSlotRule = {
  position: string;
  slotCount: number;
};


export type NbaScoringRules = {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
};


export type NflScoringRules = {
  passingYards: number;
  passingTouchdowns: number;
  passingInterceptions: number;

  rushingYards: number;
  rushingTouchdowns: number;

  receivingYards: number;
  receivingTouchdowns: number;
  receptions: number;

  fumblesLost: number;

  dstSacks: number;
  dstInterceptions: number;
  dstFumbleRecoveries: number;
  dstSafeties: number;
  dstTouchdowns: number;

  dstPointsAllowed0: number;
  dstPointsAllowed1To6: number;
  dstPointsAllowed7To13: number;
  dstPointsAllowed14To20: number;
  dstPointsAllowed21To27: number;
  dstPointsAllowed28To34: number;
  dstPointsAllowed35Plus: number;

  dstYardsAllowedUnder100: number;
  dstYardsAllowed100To199: number;
  dstYardsAllowed200To299: number;
  dstYardsAllowed300To349: number;
  dstYardsAllowed350To399: number;
  dstYardsAllowed400To449: number;
  dstYardsAllowed450Plus: number;
};


export type LeagueRules = {
  schemaVersion: 1;

  sport:
    SlateSport;

  roster: {
    slots:
      RosterSlotRule[];
  };

  draft: {
    type:
      DraftType;
  };

  scoring:
    | NbaScoringRules
    | NflScoringRules
    | Record<
        string,
        number
      >;
};


export type LeagueSettingsInput =
  Record<
    string,
    unknown
  >;

export type NbaSkinsRules = {
  participantCount: number;
  nbaTeamsPerParticipant: number;
};

const NBA_SKINS_DEFAULT_RULES: NbaSkinsRules = {
  participantCount: 4,
  nbaTeamsPerParticipant: 7,
};

export function getDefaultNbaSkinsRules(): NbaSkinsRules {
  return { ...NBA_SKINS_DEFAULT_RULES };
}

export function resolveNbaSkinsRules(
  settings: LeagueSettingsInput | null | undefined,
): NbaSkinsRules {
  const safeSettings = settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings
    : {};
  const draft = safeSettings.draft && typeof safeSettings.draft === "object" &&
    !Array.isArray(safeSettings.draft)
    ? safeSettings.draft as Record<string, unknown>
    : {};
  const participantCount = Number(
    draft.participantCount ?? draft.participant_count,
  );
  const nbaTeamsPerParticipant = Number(
    draft.nbaTeamsPerParticipant ?? draft.nba_teams_per_participant,
  );

  return {
    participantCount: Number.isInteger(participantCount) && participantCount >= 2
      ? participantCount
      : NBA_SKINS_DEFAULT_RULES.participantCount,
    nbaTeamsPerParticipant:
      Number.isInteger(nbaTeamsPerParticipant) && nbaTeamsPerParticipant >= 1
        ? nbaTeamsPerParticipant
        : NBA_SKINS_DEFAULT_RULES.nbaTeamsPerParticipant,
  };
}


const NBA_DEFAULT_RULES:
  LeagueRules = {
  schemaVersion:
    1,

  sport:
    "nba",

  roster: {
    slots: [
      {
        position:
          "G",

        slotCount:
          2,
      },

      {
        position:
          "F/C",

        slotCount:
          3,
      },
    ],
  },

  draft: {
    type:
      "snake",
  },

  scoring: {
    points:
      1,

    rebounds:
      1.2,

    assists:
      1.5,

    steals:
      2,

    blocks:
      2,

    turnovers:
      -1,
  },
};


const NFL_DEFAULT_RULES:
  LeagueRules = {
  schemaVersion:
    1,

  sport:
    "nfl",

  roster: {
    slots: [
      {
        position:
          "QB",

        slotCount:
          1,
      },

      {
        position:
          "RB",

        slotCount:
          2,
      },

      {
        position:
          "WR",

        slotCount:
          2,
      },

      {
        position:
          "TE",

        slotCount:
          1,
      },

      {
        position:
          "K",

        slotCount:
          0,
      },

      {
        position:
          "FLEX",

        slotCount:
          0,
      },

      {
        position:
          "SF",

        slotCount:
          0,
      },

      {
        position:
          "D/ST",

        slotCount:
          0,
      },
    ],
  },

  draft: {
    type:
      "snake",
  },

  scoring: {
    passingYards:
      1 / 25,

    passingTouchdowns:
      4,

    passingInterceptions:
      -2,

    rushingYards:
      1 / 10,

    rushingTouchdowns:
      6,

    receivingYards:
      1 / 10,

    receivingTouchdowns:
      6,

    receptions:
      1,

    fumblesLost:
      -2,

    dstSacks:
      1,

    dstInterceptions:
      2,

    dstFumbleRecoveries:
      2,

    dstSafeties:
      2,

    dstTouchdowns:
      6,

    dstPointsAllowed0:
      10,

    dstPointsAllowed1To6:
      7,

    dstPointsAllowed7To13:
      4,

    dstPointsAllowed14To20:
      1,

    dstPointsAllowed21To27:
      0,

    dstPointsAllowed28To34:
      -1,

    dstPointsAllowed35Plus:
      -4,

    dstYardsAllowedUnder100:
      5,

    dstYardsAllowed100To199:
      3,

    dstYardsAllowed200To299:
      2,

    dstYardsAllowed300To349:
      0,

    dstYardsAllowed350To399:
      -1,

    dstYardsAllowed400To449:
      -3,

    dstYardsAllowed450Plus:
      -5,
  },
};


const GOLF_DEFAULT_RULES:
  LeagueRules = {
  schemaVersion:
    1,

  sport:
    "golf",

  roster: {
    slots: [
      {
        position:
          "GOLFER",

        slotCount:
          4,
      },
    ],
  },

  draft: {
    type:
      "snake",
  },

  /*
   * Standard Golf scoring currently lives in the Golf pipeline
   * rather than a simple weighted-stat formula.
   *
   * Keep this empty until the Golf rules pass deliberately
   * moves those rules into the shared engine.
   */
  scoring:
    {},
};


function cloneRules(
  rules:
    LeagueRules,
): LeagueRules {
  return structuredClone(
    rules,
  );
}


export function getDefaultLeagueRules(
  sport:
    SlateSport,
): LeagueRules {
  if (
    sport ===
    "nfl"
  ) {
    return cloneRules(
      NFL_DEFAULT_RULES,
    );
  }


  if (
    sport ===
    "golf"
  ) {
    return cloneRules(
      GOLF_DEFAULT_RULES,
    );
  }


  return cloneRules(
    NBA_DEFAULT_RULES,
  );
}


function isRecord(
  value:
    unknown,
): value is Record<
  string,
  unknown
> {
  return Boolean(
    value &&
      typeof value ===
        "object" &&
      !Array.isArray(
        value,
      ),
  );
}


function safeSlotCount(
  value:
    unknown,
) {
  const number =
    Number(
      value,
    );


  if (
    !Number.isInteger(
      number,
    ) ||
    number < 0 ||
    number > 50
  ) {
    return null;
  }


  return number;
}


function resolveRoster(
  defaults:
    LeagueRules["roster"],

  settings:
    LeagueSettingsInput,
) {
  const roster =
    isRecord(
      settings.roster,
    )
      ? settings.roster
      : null;


  if (
    !roster ||
    !Array.isArray(
      roster.slots,
    )
  ) {
    return defaults;
  }


  const slots =
    roster.slots
      .map(
        (
          rawSlot,
        ) => {
          if (
            !isRecord(
              rawSlot,
            )
          ) {
            return null;
          }


          const position =
            typeof rawSlot.position ===
            "string"
              ? rawSlot.position
                  .trim()
                  .toUpperCase()
              : "";


          const slotCount =
            safeSlotCount(
              rawSlot.slotCount ??
                rawSlot.slot_count,
            );


          if (
            !position ||
            slotCount ===
              null
          ) {
            return null;
          }


          return {
            position,
            slotCount,
          };
        },
      )
      .filter(
        (
          slot,
        ): slot is RosterSlotRule =>
          Boolean(
            slot,
          ),
      );


  return slots.length > 0
    ? {
        slots,
      }
    : defaults;
}


function resolveDraft(
  defaults:
    LeagueRules["draft"],

  settings:
    LeagueSettingsInput,
): LeagueRules["draft"] {
  const draft =
    isRecord(
      settings.draft,
    )
      ? settings.draft
      : null;


  const type =
    draft?.type;


  if (
    type !==
      "snake" &&
    type !==
      "linear"
  ) {
    return defaults;
  }


  return {
    type,
  };
}


function resolveScoring(
  defaults:
    LeagueRules["scoring"],

  settings:
    LeagueSettingsInput,
) {
  const scoring =
    isRecord(
      settings.scoring,
    )
      ? settings.scoring
      : null;


  if (
    !scoring
  ) {
    return defaults;
  }


  const merged:
    Record<
      string,
      number
    > = {
      ...defaults,
    };


  for (
    const [
      key,
      rawValue,
    ]
    of Object.entries(
      scoring,
    )
  ) {
    const number =
      Number(
        rawValue,
      );


    if (
      Number.isFinite(
        number,
      )
    ) {
      merged[
        key
      ] =
        number;
    }
  }


  return merged;
}


export function resolveLeagueRules({
  sport,
  settings,
}: {
  sport:
    SlateSport;

  settings:
    LeagueSettingsInput |
    null |
    undefined;
}): LeagueRules {
  const defaults =
    getDefaultLeagueRules(
      sport,
    );


  const safeSettings =
    isRecord(
      settings,
    )
      ? settings
      : {};


  return {
    schemaVersion:
      1,

    sport,

    roster:
      resolveRoster(
        defaults.roster,
        safeSettings,
      ),

    draft:
      resolveDraft(
        defaults.draft,
        safeSettings,
      ),

    scoring:
      resolveScoring(
        defaults.scoring,
        safeSettings,
      ),
  };
}


export function getDefaultRosterSlotsForSport(
  sport:
    SlateSport,
) {
  return getDefaultLeagueRules(
    sport,
  ).roster.slots.map(
    (
      slot,
    ) => ({
      position:
        slot.position,

      slot_count:
        slot.slotCount,
    }),
  );
}

export function getRosterSlotsFromRulesSnapshot(
  snapshot:
    Record<string, unknown> |
    null |
    undefined,

  sport:
    SlateSport,
) {
  if (
    snapshot &&
    typeof snapshot ===
      "object" &&
    !Array.isArray(
      snapshot,
    )
  ) {
    const resolved =
      resolveLeagueRules({
        sport,
        settings:
          snapshot,
      });


    return resolved.roster.slots.map(
      (
        slot,
        index,
      ) => ({
        sport,
        position:
          slot.position,
        slot_count:
          slot.slotCount,
        display_order:
          index + 1,
      }),
    );
  }


  return getDefaultLeagueRules(
    sport,
  ).roster.slots.map(
    (
      slot,
      index,
    ) => ({
      sport,
      position:
        slot.position,
      slot_count:
        slot.slotCount,
      display_order:
        index + 1,
    }),
  );
}

export type RosterSlotLike = {
  position: string;
  slot_count: number;
};


export function canPlayerFillRosterSlot(
  sport:
    SlateSport,

  playerPosition:
    string,

  slotPosition:
    string,
) {
  const rawPlayer =
    playerPosition
      .trim()
      .toUpperCase();

  const slot =
    slotPosition
      .trim()
      .toUpperCase();


  /*
   * Client-facing NBA players normally carry position_group:
   *
   *   G
   *   F/C
   *
   * Some server/database paths still carry a player's more
   * specific basketball position instead:
   *
   *   PG / SG / SF / PF / C
   *
   * Normalize both representations here so every rules consumer
   * uses the same eligibility behavior.
   */
  const player =
    sport === "nba"
      ? (
          rawPlayer === "PG" ||
          rawPlayer === "SG" ||
          rawPlayer === "G"
            ? "G"
            : rawPlayer === "SF" ||
                rawPlayer === "PF" ||
                rawPlayer === "C" ||
                rawPlayer === "F" ||
                rawPlayer === "F/C" ||
                rawPlayer === "FC"
              ? "F/C"
              : rawPlayer
        )
      : rawPlayer;


  /*
   * Golf has a single generic roster position. Golf players do not
   * need to carry a synthetic "GOLFER" position_group in order to
   * occupy one of these slots; being in the Golf player pool is the
   * eligibility constraint.
   */
  if (
    sport ===
      "golf" &&
    slot ===
      "GOLFER"
  ) {
    return true;
  }


  if (
    player ===
    slot
  ) {
    return true;
  }


  if (
    sport ===
      "nba" &&
    slot ===
      "UTIL"
  ) {
    return (
      player === "G" ||
      player === "F/C"
    );
  }


  if (
    sport ===
      "nfl" &&
    slot ===
      "FLEX"
  ) {
    return (
      player === "RB" ||
      player === "WR" ||
      player === "TE"
    );
  }


  if (
    sport ===
      "nfl" &&
    (
      slot ===
        "SUPERFLEX" ||
      slot ===
        "SF"
    )
  ) {
    return (
      player === "QB" ||
      player === "RB" ||
      player === "WR" ||
      player === "TE"
    );
  }


  return false;
}


export type ExpandedRosterSlot = {
  position: string;
  slotIndex: number;
};


export function expandRosterSlots(
  rosterSlots:
    RosterSlotLike[],
): ExpandedRosterSlot[] {
  const expanded:
    ExpandedRosterSlot[] =
    [];


  for (
    const slot
    of rosterSlots
  ) {
    const count =
      Math.max(
        0,
        Number(
          slot.slot_count ??
            0,
        ),
      );


    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      expanded.push({
        position:
          slot.position,

        slotIndex:
          index,
      });
    }
  }


  return expanded;
}


export function assignPlayersToRosterSlots({
  sport,
  playerPositions,
  rosterSlots,
}: {
  sport:
    SlateSport;

  playerPositions:
    string[];

  rosterSlots:
    RosterSlotLike[];
}) {
  const slots =
    expandRosterSlots(
      rosterSlots,
    );


  /*
   * Bipartite matching lets flexible slots work correctly without
   * greedy edge cases.
   *
   * Example:
   *   slots = G, UTIL
   *   players = G, F/C
   *
   * The G must be allowed to occupy G while F/C occupies UTIL.
   */
  const playerForSlot =
    new Array<number>(
      slots.length,
    ).fill(
      -1,
    );


  function tryPlacePlayer(
    playerIndex:
      number,

    visited:
      Set<number>,
  ): boolean {
    for (
      let slotIndex = 0;
      slotIndex <
      slots.length;
      slotIndex += 1
    ) {
      if (
        visited.has(
          slotIndex,
        )
      ) {
        continue;
      }


      const slot =
        slots[
          slotIndex
        ];


      if (
        !canPlayerFillRosterSlot(
          sport,
          playerPositions[
            playerIndex
          ] ??
            "",
          slot.position,
        )
      ) {
        continue;
      }


      visited.add(
        slotIndex,
      );


      const previousPlayer =
        playerForSlot[
          slotIndex
        ];


      if (
        previousPlayer ===
          -1 ||
        tryPlacePlayer(
          previousPlayer,
          visited,
        )
      ) {
        playerForSlot[
          slotIndex
        ] =
          playerIndex;

        return true;
      }
    }


    return false;
  }


  const unmatchedPlayerIndexes:
    number[] =
    [];


  for (
    let playerIndex = 0;
    playerIndex <
    playerPositions.length;
    playerIndex += 1
  ) {
    const placed =
      tryPlacePlayer(
        playerIndex,
        new Set<number>(),
      );


    if (!placed) {
      unmatchedPlayerIndexes.push(
        playerIndex,
      );
    }
  }


  return {
    fits:
      unmatchedPlayerIndexes.length ===
      0,

    slots:
      slots.map(
        (
          slot,
          index,
        ) => ({
          ...slot,

          playerIndex:
            playerForSlot[
              index
            ],
        }),
      ),

    unmatchedPlayerIndexes,

    remainingSlots:
      slots.filter(
        (
          _slot,
          index,
        ) =>
          playerForSlot[
            index
          ] ===
          -1,
      ),
  };
}
