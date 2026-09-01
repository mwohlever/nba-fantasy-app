"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import {
  useSearchParams,
} from "next/navigation";

import AppNav from "@/components/AppNav";

import {
  useGroupContext,
} from "@/components/providers/GroupProvider";

import {
  getDefaultLeagueRules,
  type NbaScoringRules,
  type NflScoringRules,
} from "@/lib/rules/leagueRules";


const CANONICAL_NFL_SCORING =
  getDefaultLeagueRules(
    "nfl",
  ).scoring as NflScoringRules;


function getNflScoringInputValue(
  scoring:
    NflScoringRules,

  key:
    keyof NflScoringRules,
) {
  const value =
    scoring[
      key
    ];

  return Number.isFinite(
    value,
  )
    ? value
    : CANONICAL_NFL_SCORING[
        key
      ];
}


type LeagueRow = {
  id: string;
  group_id: string;
  sport_key: string;
  game_mode: string;
  name: string;
  slug: string;
  is_enabled: boolean;

  settings_version?: number | null;

  settings?:
    Record<string, unknown> |
    null;
};


type TeamSummary = {
  id: number;
  name: string;
};


type MemberRow = {
  id: string;
  group_id: string;
  user_id: string;

  role:
    | "member"
    | "admin";

  is_active: boolean;
  joined_at: string;

  display_name: string;
  email: string | null;
  avatar_url: string | null;
  system_role: string;

  team:
    TeamSummary |
    null;
};


type InviteRow = {
  id: string;
  group_id: string;
  email: string;

  status:
    | "pending"
    | "accepted"
    | "revoked"
    | "expired";

  invited_by_user_id:
    string |
    null;

  accepted_by_user_id:
    string |
    null;

  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};


type GroupRow = {
  id: string;
  name: string;
  slug: string;

  created_by_user_id:
    string |
    null;

  is_active: boolean;
  created_at: string;
  updated_at: string;

  leagues:
    LeagueRow[];

  members:
    MemberRow[];

  invites:
    InviteRow[];
};


type PlatformUserRow = {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  system_role: string;
};


type GroupsResponse = {
  success?: boolean;

  error?: string;

  permissions?: {
    isSuperAdmin: boolean;
    canCreateGroups: boolean;
  };

  currentUser?: {
    id: string;
    displayName: string;
    email: string | null;
    systemRole: string;
  };

  groups?:
    GroupRow[];

  platformUsers?:
    PlatformUserRow[];
};


const GAME_OPTIONS = [
  {
    key:
      "nba",
    emoji:
      "🏀",
    label:
      "NBA",
  },
  {
    key:
      "nba_skins",
    emoji:
      "🏀",
    label:
      "NBA Skins",
  },
  {
    key:
      "nfl",
    emoji:
      "🏈",
    label:
      "NFL",
  },
  {
    key:
      "ncaa_pickem",
    emoji:
      "🏈",
    label:
      "NCAA Pick 'Em",
  },
  {
    key:
      "golf",
    emoji:
      "⛳",
    label:
      "Golf",
  },
] as const;


function formatDate(
  value:
    string |
    null,
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    undefined,
    {
      month:
        "short",

      day:
        "numeric",

      year:
        "numeric",

      hour:
        "numeric",

      minute:
        "2-digit",
    },
  );
}


function inviteStatusClass(
  status:
    InviteRow["status"],
) {
  if (
    status ===
    "accepted"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (
    status ===
    "pending"
  ) {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (
    status ===
    "expired"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-600";
}


export default function GroupsAdminPage() {
  const {
    groupContext,
    refreshGroupContext,
  } =
    useGroupContext();


  const searchParams =
    useSearchParams();


  const commissionerView =
    searchParams.get(
      "view",
    ) ===
    "commissioner";


  const [
    data,
    setData,
  ] =
    useState<GroupsResponse | null>(
      null,
    );

  const [
    selectedGroupId,
    setSelectedGroupId,
  ] =
    useState(
      "",
    );

  const [
    groupPickerOpen,
    setGroupPickerOpen,
  ] =
    useState(
      false,
    );

  const [
    groupSearch,
    setGroupSearch,
  ] =
    useState(
      "",
    );

  const [
    memberSearch,
    setMemberSearch,
  ] =
    useState(
      "",
    );


  const [
    showInactiveMembers,
    setShowInactiveMembers,
  ] =
    useState(
      false,
    );

  const [
    inviteSearch,
    setInviteSearch,
  ] =
    useState(
      "",
    );

  const [
    showCreateGroup,
    setShowCreateGroup,
  ] =
    useState(
      false,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  const [
    message,
    setMessage,
  ] =
    useState(
      "",
    );

  const [
    error,
    setError,
  ] =
    useState(
      "",
    );

  const [
    inviteEmail,
    setInviteEmail,
  ] =
    useState(
      "",
    );

  const [
    latestInviteUrl,
    setLatestInviteUrl,
  ] =
    useState(
      "",
    );

  const [
    latestInviteEmail,
    setLatestInviteEmail,
  ] =
    useState(
      "",
    );

  const [
    nbaRosterGuards,
    setNbaRosterGuards,
  ] =
    useState(
      2,
    );


  const [
    nbaRosterForwardsCenters,
    setNbaRosterForwardsCenters,
  ] =
    useState(
      3,
    );


  const [
    nbaRosterUtility,
    setNbaRosterUtility,
  ] =
    useState(
      0,
    );


  const [
    nflRoster,
    setNflRoster,
  ] =
    useState({
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      K: 0,
      FLEX: 0,
      SF: 0,
      "D/ST": 0,
    });


  const [
    settingsTab,
    setSettingsTab,
  ] =
    useState<
      | "overview"
      | "rules"
      | "members"
      | "invites"
    >(
      "overview",
    );


  const [
    rulesSport,
    setRulesSport,
  ] =
    useState<
      | "nba"
      | "nfl"
      | "golf"
    >(
      "nba",
    );


  const [
    nbaScoring,
    setNbaScoring,
  ] =
    useState<NbaScoringRules>(
      () =>
        getDefaultLeagueRules(
          "nba",
        ).scoring as NbaScoringRules,
    );


  const [
    nflScoring,
    setNflScoring,
  ] =
    useState<NflScoringRules>(
      () =>
        getDefaultLeagueRules(
          "nfl",
        ).scoring as NflScoringRules,
    );


  const [
    newGroupName,
    setNewGroupName,
  ] =
    useState(
      "",
    );

  const [
    newGroupSlug,
    setNewGroupSlug,
  ] =
    useState(
      "",
    );

  const [
    newGroupSports,
    setNewGroupSports,
  ] =
    useState<string[]>(
      [
        "nba",
        "nba_skins",
        "nfl",
        "ncaa_pickem",
        "golf",
      ],
    );


  const [
    newGroupAdminUserId,
    setNewGroupAdminUserId,
  ] =
    useState(
      "",
    );


  const [
    newGroupAdminSearch,
    setNewGroupAdminSearch,
  ] =
    useState(
      "",
    );


  const [
    newGroupAdminPickerOpen,
    setNewGroupAdminPickerOpen,
  ] =
    useState(
      false,
    );


  const groups =
    data?.groups ??
    [];


  const platformUsers =
    data?.platformUsers ??
    [];


  const selectedNewGroupAdmin =
    useMemo(
      () =>
        platformUsers.find(
          (platformUser) =>
            platformUser.id ===
            newGroupAdminUserId,
        ) ??
        null,
      [
        platformUsers,
        newGroupAdminUserId,
      ],
    );


  const filteredPlatformUsers =
    useMemo(
      () => {
        const query =
          newGroupAdminSearch
            .trim()
            .toLowerCase();

        if (!query) {
          return platformUsers;
        }

        return platformUsers.filter(
          (platformUser) =>
            platformUser.display_name
              .toLowerCase()
              .includes(
                query,
              ) ||
            (
              platformUser.email ??
              ""
            )
              .toLowerCase()
              .includes(
                query,
              ),
        );
      },
      [
        platformUsers,
        newGroupAdminSearch,
      ],
    );


  const selectedGroup =
    useMemo(
      () =>
        groups.find(
          (group) =>
            group.id ===
            selectedGroupId,
        ) ??
        groups[0] ??
        null,
      [
        groups,
        selectedGroupId,
      ],
    );


  const nbaLeague =
    selectedGroup?.leagues.find(
      (league) =>
        league.sport_key ===
          "nba" &&
        league.game_mode ===
          "standard",
    ) ??
    null;


  const nflLeague =
    selectedGroup?.leagues.find(
      (league) =>
        league.sport_key ===
          "nfl" &&
        league.game_mode ===
          "standard",
    ) ??
    null;


  useEffect(
    () => {
      const settings =
        nbaLeague?.settings &&
        typeof nbaLeague.settings ===
          "object" &&
        !Array.isArray(
          nbaLeague.settings,
        )
          ? nbaLeague.settings as Record<
              string,
              unknown
            >
          : {};


      const roster =
        settings.roster &&
        typeof settings.roster ===
          "object" &&
        !Array.isArray(
          settings.roster,
        )
          ? settings.roster as Record<
              string,
              unknown
            >
          : {};


      const slots =
        Array.isArray(
          roster.slots,
        )
          ? roster.slots
          : [];


      function readCount(
        position:
          string,

        fallback:
          number,
      ) {
        const slot =
          slots.find(
            (
              candidate,
            ) =>
              candidate &&
              typeof candidate ===
                "object" &&
              !Array.isArray(
                candidate,
              ) &&
              String(
                (
                  candidate as Record<
                    string,
                    unknown
                  >
                ).position ??
                  "",
              )
                .trim()
                .toUpperCase() ===
                position,
          ) as
            | Record<
                string,
                unknown
              >
            | undefined;


        const value =
          Number(
            slot?.slotCount ??
            slot?.slot_count,
          );


        return Number.isInteger(
          value,
        ) &&
        value >= 0
          ? value
          : fallback;
      }


      setNbaRosterGuards(
        readCount(
          "G",
          2,
        ),
      );

      setNbaRosterForwardsCenters(
        readCount(
          "F/C",
          3,
        ),
      );

      setNbaRosterUtility(
        readCount(
          "UTIL",
          0,
        ),
      );


      const defaultScoring =
        getDefaultLeagueRules(
          "nba",
        ).scoring as NbaScoringRules;

      const savedScoring =
        settings.scoring &&
        typeof settings.scoring ===
          "object" &&
        !Array.isArray(
          settings.scoring,
        )
          ? settings.scoring as Record<
              string,
              unknown
            >
          : {};

      setNbaScoring({
        points:
          Number.isFinite(
            Number(
              savedScoring.points,
            ),
          )
            ? Number(
                savedScoring.points,
              )
            : defaultScoring.points,

        rebounds:
          Number.isFinite(
            Number(
              savedScoring.rebounds,
            ),
          )
            ? Number(
                savedScoring.rebounds,
              )
            : defaultScoring.rebounds,

        assists:
          Number.isFinite(
            Number(
              savedScoring.assists,
            ),
          )
            ? Number(
                savedScoring.assists,
              )
            : defaultScoring.assists,

        steals:
          Number.isFinite(
            Number(
              savedScoring.steals,
            ),
          )
            ? Number(
                savedScoring.steals,
              )
            : defaultScoring.steals,

        blocks:
          Number.isFinite(
            Number(
              savedScoring.blocks,
            ),
          )
            ? Number(
                savedScoring.blocks,
              )
            : defaultScoring.blocks,

        turnovers:
          Number.isFinite(
            Number(
              savedScoring.turnovers,
            ),
          )
            ? Number(
                savedScoring.turnovers,
              )
            : defaultScoring.turnovers,
      });
    },
    [
      nbaLeague?.id,
      nbaLeague?.settings,
    ],
  );


  useEffect(
    () => {
      const settings =
        nflLeague?.settings &&
        typeof nflLeague.settings ===
          "object" &&
        !Array.isArray(
          nflLeague.settings,
        )
          ? nflLeague.settings as Record<
              string,
              unknown
            >
          : {};

      const defaultRoster =
        getDefaultLeagueRules(
          "nfl",
        ).roster.slots;

      const roster =
        settings.roster &&
        typeof settings.roster ===
          "object" &&
        !Array.isArray(
          settings.roster,
        )
          ? settings.roster as Record<
              string,
              unknown
            >
          : {};

      const savedSlots =
        Array.isArray(
          roster.slots,
        )
          ? roster.slots
          : [];

      function readRosterCount(
        position:
          string,
      ) {
        const savedSlot =
          savedSlots.find(
            (
              candidate,
            ) =>
              candidate &&
              typeof candidate ===
                "object" &&
              !Array.isArray(
                candidate,
              ) &&
              String(
                (
                  candidate as Record<
                    string,
                    unknown
                  >
                ).position ??
                  "",
              )
                .trim()
                .toUpperCase() ===
                position,
          ) as
            | Record<
                string,
                unknown
              >
            | undefined;

        const savedValue =
          Number(
            savedSlot?.slotCount ??
              savedSlot?.slot_count,
          );

        if (
          Number.isInteger(
            savedValue,
          ) &&
          savedValue >= 0
        ) {
          return savedValue;
        }

        const defaultSlot =
          defaultRoster.find(
            (slot) =>
              slot.position ===
              position,
          );

        return Number(
          defaultSlot?.slotCount ??
            0,
        );
      }

      setNflRoster({
        QB:
          readRosterCount(
            "QB",
          ),

        RB:
          readRosterCount(
            "RB",
          ),

        WR:
          readRosterCount(
            "WR",
          ),

        TE:
          readRosterCount(
            "TE",
          ),

        K:
          readRosterCount(
            "K",
          ),

        FLEX:
          readRosterCount(
            "FLEX",
          ),

        SF:
          readRosterCount(
            "SF",
          ),

        "D/ST":
          readRosterCount(
            "D/ST",
          ),
      });


      const defaultScoring =
        getDefaultLeagueRules(
          "nfl",
        ).scoring as NflScoringRules;

      const savedScoring =
        settings.scoring &&
        typeof settings.scoring ===
          "object" &&
        !Array.isArray(
          settings.scoring,
        )
          ? settings.scoring as Record<
              string,
              unknown
            >
          : {};

      function readScoringValue(
        key:
          keyof NflScoringRules,
      ) {
        const value =
          Number(
            savedScoring[
              key
            ],
          );

        return Number.isFinite(
          value,
        )
          ? value
          : defaultScoring[
              key
            ];
      }

      setNflScoring(
        Object.fromEntries(
          (
            Object.keys(
              defaultScoring,
            ) as Array<
              keyof NflScoringRules
            >
          ).map(
            (key) => [
              key,
              readScoringValue(
                key,
              ),
            ],
          ),
        ) as NflScoringRules,
      );
    },
    [
      nflLeague?.id,
      nflLeague?.settings,
    ],
  );


  const filteredGroups =
    useMemo(
      () => {
        const query =
          groupSearch
            .trim()
            .toLowerCase();

        if (!query) {
          return groups;
        }

        return groups.filter(
          (group) =>
            group.name
              .toLowerCase()
              .includes(
                query,
              ) ||
            group.slug
              .toLowerCase()
              .includes(
                query,
              ),
        );
      },
      [
        groups,
        groupSearch,
      ],
    );


  const memberMatchesSearch =
    (
      member:
        MemberRow,
    ) => {
      const query =
        memberSearch
          .trim()
          .toLowerCase();

      if (!query) {
        return true;
      }

      return (
        member.display_name
          .toLowerCase()
          .includes(
            query,
          ) ||
        (
          member.email ??
          ""
        )
          .toLowerCase()
          .includes(
            query,
          ) ||
        (
          member.team?.name ??
          ""
        )
          .toLowerCase()
          .includes(
            query,
          )
      );
    };


  const activeMembers =
    useMemo(
      () =>
        (
          selectedGroup?.members ??
          []
        ).filter(
          (member) =>
            member.is_active &&
            memberMatchesSearch(
              member,
            ),
        ),
      [
        selectedGroup,
        memberSearch,
      ],
    );


  const inactiveMembers =
    useMemo(
      () =>
        (
          selectedGroup?.members ??
          []
        ).filter(
          (member) =>
            !member.is_active &&
            memberMatchesSearch(
              member,
            ),
        ),
      [
        selectedGroup,
        memberSearch,
      ],
    );


  const inactiveMemberCount =
    (
      selectedGroup?.members ??
      []
    ).filter(
      (member) =>
        !member.is_active,
    ).length;


  const filteredInvites =
    useMemo(
      () => {
        const invites =
          selectedGroup?.invites ??
          [];

        const query =
          inviteSearch
            .trim()
            .toLowerCase();

        if (!query) {
          return invites;
        }

        return invites.filter(
          (invite) =>
            invite.email
              .toLowerCase()
              .includes(
                query,
              ) ||
            invite.status
              .toLowerCase()
              .includes(
                query,
              ),
        );
      },
      [
        selectedGroup,
        inviteSearch,
      ],
    );


  async function loadGroups(
    preferredGroupId?:
      string,
  ) {
    try {
      setLoading(
        true,
      );

      setError(
        "",
      );

      const response =
        await fetch(
          "/api/admin/groups",
          {
            cache:
              "no-store",
          },
        );

      const result =
        (
          await response.json()
        ) as GroupsResponse;

      if (
        !response.ok
      ) {
        throw new Error(
          result.error ??
            "Unable to load Groups.",
        );
      }

      setData(
        result,
      );

      const nextGroups =
        result.groups ??
        [];

      const preferred =
        preferredGroupId ??
        selectedGroupId;

      const nextSelected =
        nextGroups.find(
          (group) =>
            group.id ===
            preferred,
        ) ??
        nextGroups[0] ??
        null;

      setSelectedGroupId(
        nextSelected?.id ??
          "",
      );
    } catch (
      loadError
    ) {
      console.error(
        "Failed to load Groups",
        loadError,
      );

      setError(
        loadError instanceof
        Error
          ? loadError.message
          : "Unable to load Groups.",
      );
    } finally {
      setLoading(
        false,
      );
    }
  }


  useEffect(
    () => {
      /*
       * Commissioner Group Settings is always scoped to the
       * app-level active Group.
       *
       * Do not perform the initial Groups request until
       * GroupProvider has resolved that active Group. Otherwise
       * the first Group returned by /api/admin/groups can briefly
       * render as the wrong Group.
       */
      if (
        commissionerView
      ) {
        const activeGroupId =
          groupContext?.group.id;


        if (
          !activeGroupId
        ) {
          return;
        }


        setSelectedGroupId(
          activeGroupId,
        );


        setGroupPickerOpen(
          false,
        );


        setLatestInviteUrl(
          "",
        );


        setLatestInviteEmail(
          "",
        );


        void loadGroups(
          activeGroupId,
        );


        return;
      }


      /*
       * Bare /admin/groups remains the Super Admin platform view
       * and may load the complete Group list immediately.
       */
      void loadGroups();
    },
    [
      commissionerView,
      groupContext?.group.id,
    ],
  );


  async function runAction(
    body:
      Record<
        string,
        unknown
      >,
  ) {
    setSaving(
      true,
    );

    setError(
      "",
    );

    setMessage(
      "",
    );

    try {
      const response =
        await fetch(
          "/api/admin/groups",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                body,
              ),
          },
        );

      const result =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          String(
            result.error ??
              "Unable to update Group.",
          ),
        );
      }

      return result;
    } catch (
      actionError
    ) {
      console.error(
        "Group admin action failed",
        actionError,
      );

      setError(
        actionError instanceof
        Error
          ? actionError.message
          : "Unable to update Group.",
      );

      return null;
    } finally {
      setSaving(
        false,
      );
    }
  }


  async function createGroup() {
    const result =
      await runAction({
        action:
          "create_group",

        name:
          newGroupName,

        slug:
          newGroupSlug,

        sports:
          newGroupSports,

        initialAdminUserId:
          newGroupAdminUserId,
      });

    if (!result) {
      return;
    }

    setNewGroupName(
      "",
    );

    setNewGroupSlug(
      "",
    );

    setNewGroupAdminUserId(
      "",
    );

    setNewGroupAdminSearch(
      "",
    );

    setNewGroupAdminPickerOpen(
      false,
    );

    setShowCreateGroup(
      false,
    );

    setMessage(
      `Created ${result.group.name}.`,
    );

    await Promise.all([
      loadGroups(
        result.group.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function createInvite(
    email:
      string,
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }

    const normalized =
      email
        .trim()
        .toLowerCase();

    const result =
      await runAction({
        action:
          "create_invite",

        groupId:
          selectedGroup.id,

        email:
          normalized,
      });

    if (!result) {
      return;
    }

    setLatestInviteUrl(
      String(
        result.inviteUrl ??
          "",
      ),
    );

    setLatestInviteEmail(
      normalized,
    );

    setInviteEmail(
      "",
    );

    setMessage(
      `Invitation created for ${normalized}.`,
    );

    await loadGroups(
      selectedGroup.id,
    );
  }


  async function revokeInvite(
    invite:
      InviteRow,
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }

    const result =
      await runAction({
        action:
          "revoke_invite",

        groupId:
          selectedGroup.id,

        inviteId:
          invite.id,
      });

    if (!result) {
      return;
    }

    setMessage(
      `Revoked invitation for ${invite.email}.`,
    );

    if (
      latestInviteEmail ===
      invite.email
    ) {
      setLatestInviteUrl(
        "",
      );

      setLatestInviteEmail(
        "",
      );
    }

    await loadGroups(
      selectedGroup.id,
    );
  }


  async function updateMemberRole(
    membership:
      MemberRow,

    role:
      "member" |
      "admin",
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }

    const result =
      await runAction({
        action:
          "update_member_role",

        groupId:
          selectedGroup.id,

        membershipId:
          membership.id,

        role,
      });

    if (!result) {
      return;
    }

    setMessage(
      `${membership.display_name} is now a Group ${role}.`,
    );

    await loadGroups(
      selectedGroup.id,
    );
  }


  async function removeMember(
    membership:
      MemberRow,
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }


    const confirmed =
      window.confirm(
        `Remove ${membership.display_name} from ${selectedGroup.name}?`,
      );


    if (
      !confirmed
    ) {
      return;
    }


    const result =
      await runAction({
        action:
          "remove_member",

        groupId:
          selectedGroup.id,

        membershipId:
          membership.id,
      });


    if (
      !result
    ) {
      return;
    }


    setMessage(
      `${membership.display_name} was removed from ${selectedGroup.name}.`,
    );


    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function deleteGroup() {
    if (
      !selectedGroup
    ) {
      return;
    }


    const groupName =
      selectedGroup.name;


    const confirmed =
      window.confirm(
        `Permanently delete ${groupName}? This is only allowed for inactive Groups with no slate history and cannot be undone.`,
      );


    if (
      !confirmed
    ) {
      return;
    }


    const result =
      await runAction({
        action:
          "delete_group",

        groupId:
          selectedGroup.id,
      });


    if (
      !result
    ) {
      return;
    }


    setMessage(
      `${groupName} was permanently deleted.`,
    );


    setSelectedGroupId(
      "",
    );


    await Promise.all([
      loadGroups(),

      refreshGroupContext(),
    ]);
  }


  async function setGroupActive(
    isActive:
      boolean,
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }

    const result =
      await runAction({
        action:
          "set_group_active",

        groupId:
          selectedGroup.id,

        isActive,
      });

    if (!result) {
      return;
    }

    setMessage(
      `${selectedGroup.name} is now ${isActive ? "active" : "inactive"}.`,
    );

    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function setLeagueEnabled(
    league:
      LeagueRow,

    isEnabled:
      boolean,
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }

    const result =
      await runAction({
        action:
          "set_league_enabled",

        groupId:
          selectedGroup.id,

        leagueId:
          league.id,

        isActive:
          isEnabled,
      });

    if (!result) {
      return;
    }

    setMessage(
      `${league.name} ${isEnabled ? "enabled" : "disabled"} for ${selectedGroup.name}.`,
    );

    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function saveNbaRosterRules() {
    if (
      !selectedGroup ||
      !nbaLeague
    ) {
      return;
    }


    const result =
      await runAction({
        action:
          "update_nba_roster_rules",

        groupId:
          selectedGroup.id,

        leagueId:
          nbaLeague.id,

        roster: {
          guards:
            nbaRosterGuards,

          forwardsCenters:
            nbaRosterForwardsCenters,

          utility:
            nbaRosterUtility,
        },
      });


    if (!result) {
      return;
    }


    setMessage(
      `NBA roster updated to ${
        nbaRosterGuards +
        nbaRosterForwardsCenters +
        nbaRosterUtility
      } players. New slates will use this roster.`,
    );


    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function saveNflRosterRules() {
    if (
      !selectedGroup ||
      !nflLeague
    ) {
      return;
    }


    const total =
      Object.values(
        nflRoster,
      ).reduce(
        (
          sum,
          count,
        ) =>
          sum +
          count,
        0,
      );


    if (
      total < 1
    ) {
      setMessage(
        "NFL roster must contain at least one player.",
      );

      return;
    }


    const result =
      await runAction({
        action:
          "update_nfl_roster_rules",

        groupId:
          selectedGroup.id,

        leagueId:
          nflLeague.id,

        roster:
          nflRoster,
      });


    if (!result) {
      return;
    }


    setMessage(
      `NFL roster updated to ${total} players. New slates will use this roster.`,
    );


    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function saveScoringRules(
    sport:
      "nba" |
      "nfl",
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }

    const league =
      sport ===
      "nba"
        ? nbaLeague
        : nflLeague;

    if (
      !league
    ) {
      return;
    }

    const scoring =
      sport ===
      "nba"
        ? nbaScoring
        : nflScoring;

    const result =
      await runAction({
        action:
          "update_scoring_rules",

        groupId:
          selectedGroup.id,

        leagueId:
          league.id,

        scoring,
      });

    if (
      !result
    ) {
      return;
    }

    setMessage(
      `${sport.toUpperCase()} scoring updated. New slates will use these scoring rules.`,
    );

    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function addGroupGame(
    sportKey:
      string,

    label:
      string,
  ) {
    if (
      !selectedGroup
    ) {
      return;
    }


    const result =
      await runAction({
        action:
          "set_league_enabled",

        groupId:
          selectedGroup.id,

        sportKey,

        isActive:
          true,
      });


    if (!result) {
      return;
    }


    setMessage(
      `${label} enabled for ${selectedGroup.name}.`,
    );


    await Promise.all([
      loadGroups(
        selectedGroup.id,
      ),

      refreshGroupContext(),
    ]);
  }


  async function copyInviteUrl() {
    if (
      !latestInviteUrl
    ) {
      return;
    }

    await navigator.clipboard.writeText(
      latestInviteUrl,
    );

    setMessage(
      "Invite link copied.",
    );
  }


  function toggleNewGroupSport(
    key:
      string,
  ) {
    setNewGroupSports(
      (current) =>
        current.includes(
          key,
        )
          ? current.filter(
              (value) =>
                value !==
                key,
            )
          : [
              ...current,
              key,
            ],
    );
  }


  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <AppNav />


        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-600">
                {commissionerView
                  ? "Commissioner Center"
                  : "111 Sports Platform"}
              </div>

              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {commissionerView
                  ? "Group Settings"
                  : "Groups & Access"}
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                {commissionerView
                  ? `Manage games, members, roles, and invitations${groupContext ? ` for ${groupContext.group.name}` : ""}.`
                  : "Groups, games, members, roles, and invitations."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {!commissionerView &&
              data?.permissions?.canCreateGroups ? (
                <button
                  type="button"
                  onClick={() =>
                    setShowCreateGroup(
                      (current) =>
                        !current,
                    )
                  }
                  className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white"
                >
                  {showCreateGroup
                    ? "Close"
                    : "+ Create Group"}
                </button>
              ) : null}

              <Link
                href={
                  commissionerView
                    ? "/admin"
                    : "/admin/platform"
                }
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {commissionerView
                  ? "← Commissioner Center"
                  : "← Super Admin Center"}
              </Link>
            </div>
          </div>
        </section>


        {error ? (
          <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </section>
        ) : null}


        {message ? (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {message}
          </section>
        ) : null}


        {!commissionerView &&
        showCreateGroup &&
        data?.permissions?.canCreateGroups ? (
          <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.14em] text-violet-600">
                  Super Admin
                </div>

                <h2 className="mt-1 text-lg font-semibold">
                  Create Group
                </h2>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
              <input
                value={newGroupName}
                onChange={(event) =>
                  setNewGroupName(
                    event.target.value,
                  )
                }
                placeholder="Group name"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
              />

              <input
                value={newGroupSlug}
                onChange={(event) =>
                  setNewGroupSlug(
                    event.target.value,
                  )
                }
                placeholder="URL slug (optional)"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500"
              />

              <button
                type="button"
                disabled={
                  saving ||
                  !newGroupName.trim() ||
                  !newGroupAdminUserId ||
                  newGroupSports.length ===
                    0
                }
                onClick={() =>
                  void createGroup()
                }
                className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Initial Group Admin
              </label>

              <div className="relative max-w-xl">
                <button
                  type="button"
                  onClick={() =>
                    setNewGroupAdminPickerOpen(
                      (current) =>
                        !current,
                    )
                  }
                  className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm"
                >
                  <span>
                    {selectedNewGroupAdmin
                      ? (
                          selectedNewGroupAdmin.email
                            ? `${selectedNewGroupAdmin.display_name} · ${selectedNewGroupAdmin.email}`
                            : selectedNewGroupAdmin.display_name
                        )
                      : "Choose an existing 111 Sports user"}
                  </span>

                  <span className="text-slate-400">
                    ▾
                  </span>
                </button>

                {newGroupAdminPickerOpen ? (
                  <div className="absolute z-50 mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    <input
                      autoFocus
                      value={
                        newGroupAdminSearch
                      }
                      onChange={(event) =>
                        setNewGroupAdminSearch(
                          event.target.value,
                        )
                      }
                      placeholder="Search name or email…"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                    />

                    <div className="mt-2 max-h-64 overflow-y-auto">
                      {filteredPlatformUsers.length ===
                      0 ? (
                        <div className="px-3 py-3 text-sm text-slate-500">
                          No matching users.
                        </div>
                      ) : (
                        filteredPlatformUsers.map(
                          (
                            platformUser,
                          ) => (
                            <button
                              key={
                                platformUser.id
                              }
                              type="button"
                              onClick={() => {
                                setNewGroupAdminUserId(
                                  platformUser.id,
                                );

                                setNewGroupAdminSearch(
                                  "",
                                );

                                setNewGroupAdminPickerOpen(
                                  false,
                                );
                              }}
                              className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm ${
                                newGroupAdminUserId ===
                                platformUser.id
                                  ? "bg-violet-50 font-bold text-violet-800"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <span>
                                {platformUser.display_name}
                              </span>

                              <span className="truncate text-xs text-slate-400">
                                {platformUser.email ??
                                  "No email"}
                              </span>
                            </button>
                          ),
                        )
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <p className="mt-1.5 text-xs text-slate-500">
                This user becomes the Group Admin and member. Creating the Group does not automatically add the Super Admin.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {GAME_OPTIONS.map(
                (game) => {
                  const selected =
                    newGroupSports.includes(
                      game.key,
                    );

                  return (
                    <button
                      key={game.key}
                      type="button"
                      onClick={() =>
                        toggleNewGroupSport(
                          game.key,
                        )
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        selected
                          ? "border-sky-400 bg-sky-50 text-sky-800"
                          : "border-slate-300 bg-white text-slate-500"
                      }`}
                    >
                      {game.emoji} {game.label}
                    </button>
                  );
                },
              )}
            </div>
          </section>
        ) : null}


        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
            Loading Groups…
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div
                className={`grid gap-4 lg:items-end ${
                  commissionerView
                    ? "lg:grid-cols-1"
                    : "lg:grid-cols-[320px_1fr_auto]"
                }`}
              >
                <div
                  className={
                    commissionerView
                      ? "hidden"
                      : "relative"
                  }
                >
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Group
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      setGroupPickerOpen(
                        (current) =>
                          !current,
                      )
                    }
                    className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm font-semibold"
                  >
                    <span>
                      {selectedGroup?.name ??
                        "Choose Group"}
                    </span>

                    <span className="text-slate-400">
                      ▾
                    </span>
                  </button>

                  {groupPickerOpen ? (
                    <div className="absolute z-50 mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                      <input
                        autoFocus
                        value={groupSearch}
                        onChange={(event) =>
                          setGroupSearch(
                            event.target.value,
                          )
                        }
                        placeholder="Search Groups…"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                      />

                      <div className="mt-2 max-h-64 overflow-y-auto">
                        {filteredGroups.length ===
                        0 ? (
                          <div className="px-3 py-3 text-sm text-slate-500">
                            No matching Groups.
                          </div>
                        ) : (
                          filteredGroups.map(
                            (group) => (
                              <button
                                key={group.id}
                                type="button"
                                onClick={() => {
                                  setSelectedGroupId(
                                    group.id,
                                  );

                                  setGroupPickerOpen(
                                    false,
                                  );

                                  setGroupSearch(
                                    "",
                                  );

                                  setLatestInviteUrl(
                                    "",
                                  );

                                  setLatestInviteEmail(
                                    "",
                                  );
                                }}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                                  selectedGroup?.id ===
                                  group.id
                                    ? "bg-sky-50 font-bold text-sky-800"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                <span>
                                  {group.name}
                                </span>

                                <span className="text-xs text-slate-400">
                                  /{group.slug}
                                </span>
                              </button>
                            ),
                          )
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>


                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Group status
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <div className="text-lg font-bold">
                      {selectedGroup?.name ??
                        "—"}
                    </div>

                    {selectedGroup ? (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                          selectedGroup.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-300 bg-slate-100 text-slate-600"
                        }`}
                      >
                        {selectedGroup.is_active
                          ? "ACTIVE"
                          : "INACTIVE"}
                      </span>
                    ) : null}

                    {selectedGroup ? (
                      <span className="text-xs text-slate-400">
                        /{selectedGroup.slug}
                      </span>
                    ) : null}
                  </div>
                </div>


                {selectedGroup &&
                !commissionerView &&
                data?.permissions?.isSuperAdmin ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void setGroupActive(
                          !selectedGroup.is_active,
                        )
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      {selectedGroup.is_active
                        ? "Deactivate Group"
                        : "Activate Group"}
                    </button>

                    {!selectedGroup.is_active &&
                    selectedGroup.slug !==
                      "111" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void deleteGroup()
                        }
                        className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                      >
                        Delete Group
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>


            {selectedGroup ? (
              <>
                <div className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                  {[
                    {
                      key:
                        "overview" as const,
                      label:
                        "Overview",
                    },
                    {
                      key:
                        "rules" as const,
                      label:
                        "Games & Rules",
                    },
                    {
                      key:
                        "members" as const,
                      label:
                        "Members",
                    },
                    {
                      key:
                        "invites" as const,
                      label:
                        "Invites",
                    },
                  ].map(
                    (tab) => (
                      <button
                        key={
                          tab.key
                        }
                        type="button"
                        onClick={() =>
                          setSettingsTab(
                            tab.key,
                          )
                        }
                        className={`whitespace-nowrap rounded-lg border px-4 py-2 text-sm font-bold transition ${
                          settingsTab ===
                          tab.key
                            ? "border-sky-400 bg-sky-500 text-white shadow-sm"
                            : "border-slate-600 bg-slate-800/60 text-slate-300 hover:border-slate-500 hover:bg-slate-700 hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ),
                  )}
                </div>


                {settingsTab ===
                "overview" ? (
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-semibold">
                            Enabled Games
                        </h2>

                        <p className="text-xs text-slate-500">
                          Disabled games keep all historical data and can be re-enabled later.
                        </p>
                      </div>

                      <div className="text-xs text-slate-400">
                        {
                          selectedGroup.leagues.filter(
                            (league) =>
                              league.is_enabled,
                          ).length
                        }{" "}
                        of {selectedGroup.leagues.length} enabled
                      </div>
                    </div>
                  </div>

                  {GAME_OPTIONS.some(
                    (game) =>
                      !selectedGroup.leagues.some(
                        (league) =>
                          league.sport_key ===
                          game.key,
                      ),
                  ) ? (
                    <div className="border-b border-slate-200 px-4 py-3">
                      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                        Add a game
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {GAME_OPTIONS.filter(
                          (game) =>
                            !selectedGroup.leagues.some(
                              (league) =>
                                league.sport_key ===
                                game.key,
                            ),
                        ).map(
                          (game) => (
                            <button
                              key={
                                game.key
                              }
                              type="button"
                              disabled={
                                saving
                              }
                              onClick={() =>
                                void addGroupGame(
                                  game.key,
                                  game.label,
                                )
                              }
                              className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                            >
                              + {game.emoji}{" "}
                              {game.label}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}


                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">
                            Game
                          </th>

                          <th className="px-4 py-2.5">
                            Sport key
                          </th>

                          <th className="px-4 py-2.5">
                            Mode
                          </th>

                          <th className="px-4 py-2.5 text-right">
                            Enabled
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {selectedGroup.leagues.map(
                          (league) => (
                            <tr
                              key={league.id}
                              className="border-t border-slate-100"
                            >
                              <td className="px-4 py-3 font-semibold">
                                {league.name}
                              </td>

                              <td className="px-4 py-3 font-mono text-xs text-slate-500">
                                {league.sport_key}
                              </td>

                              <td className="px-4 py-3 text-slate-500">
                                {league.game_mode}
                              </td>

                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() =>
                                    void setLeagueEnabled(
                                      league,
                                      !league.is_enabled,
                                    )
                                  }
                                  aria-label={`${league.is_enabled ? "Disable" : "Enable"} ${league.name}`}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                    league.is_enabled
                                      ? "bg-emerald-500"
                                      : "bg-slate-300"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-4 w-4 rounded-full bg-white transition ${
                                      league.is_enabled
                                        ? "translate-x-6"
                                        : "translate-x-1"
                                    }`}
                                  />
                                </button>
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>


                  </section>
                ) : null}


                {settingsTab ===
                "rules" ? (
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="font-semibold">
                            Games & Rules
                          </h2>

                          <p className="mt-0.5 text-xs text-slate-500">
                            Set the defaults used when new slates are created. Existing slates keep their frozen rules.
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                        {[
                          {
                            key:
                              "nba" as const,
                            label:
                              "🏀 NBA",
                            available:
                              Boolean(
                                nbaLeague,
                              ),
                          },
                          {
                            key:
                              "nfl" as const,
                            label:
                              "🏈 NFL",
                            available:
                              Boolean(
                                nflLeague,
                              ),
                          },
                          {
                            key:
                              "golf" as const,
                            label:
                              "⛳ Golf",
                            available:
                              selectedGroup.leagues.some(
                                (league) =>
                                  league.sport_key ===
                                    "golf" &&
                                  league.game_mode ===
                                    "standard",
                              ),
                          },
                        ].map(
                          (
                            sportOption,
                          ) => (
                            <button
                              key={
                                sportOption.key
                              }
                              type="button"
                              disabled={
                                !sportOption.available
                              }
                              onClick={() =>
                                setRulesSport(
                                  sportOption.key,
                                )
                              }
                              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                                rulesSport ===
                                sportOption.key
                                  ? "bg-white text-slate-900 shadow-sm"
                                  : "text-slate-500 hover:text-slate-900"
                              } disabled:cursor-not-allowed disabled:opacity-35`}
                            >
                              {
                                sportOption.label
                              }
                            </button>
                          ),
                        )}
                      </div>
                    </div>


                    {rulesSport ===
                      "nba" &&
                    nbaLeague?.is_enabled ? (
                      <>
                        <div className="px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">
                                Roster
                              </div>

                              <p className="mt-0.5 text-xs text-slate-500">
                                Configure the standard NBA lineup.
                              </p>
                            </div>

                            <div className="text-xs font-semibold text-slate-500">
                              {nbaRosterGuards +
                                nbaRosterForwardsCenters +
                                nbaRosterUtility}{" "}
                              total
                            </div>
                          </div>

                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          {[
                            {
                              label: "Guards",
                              value: nbaRosterGuards,
                              setValue: setNbaRosterGuards,
                            },
                            {
                              label: "F/C",
                              value: nbaRosterForwardsCenters,
                              setValue: setNbaRosterForwardsCenters,
                            },
                            {
                              label: "UTIL",
                              value: nbaRosterUtility,
                              setValue: setNbaRosterUtility,
                            },
                          ].map((item) => (
                            <label
                              key={item.label}
                              className="block"
                            >
                              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                {item.label}
                              </span>

                              <input
                                type="number"
                                min={0}
                                max={20}
                                step={1}
                                value={item.value}
                                onChange={(event) =>
                                  item.setValue(
                                    Math.max(
                                      0,
                                      Math.min(
                                        20,
                                        Number(
                                          event.target.value ||
                                            0,
                                        ),
                                      ),
                                    ),
                                  )
                                }
                                className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                              />
                            </label>
                          ))}

                          <button
                            type="button"
                            disabled={
                              saving ||
                              nbaRosterGuards +
                                nbaRosterForwardsCenters +
                                nbaRosterUtility <
                                1
                            }
                            onClick={() =>
                              void saveNbaRosterRules()
                            }
                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                          >
                            Save roster
                          </button>
                        </div>

                        <p className="mt-2 text-xs text-slate-400">
                          UTIL can be filled by either a Guard or F/C.
                        </p>
                      </div>

                      <div className="border-t border-slate-200 px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold">
                            Scoring
                          </div>

                          <p className="mt-0.5 text-xs text-slate-500">
                            Point values apply to new slates only. Existing slates keep their frozen scoring rules.
                          </p>
                        </div>

                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          {[
                            {
                              key: "points" as const,
                              label: "Point",
                            },
                            {
                              key: "rebounds" as const,
                              label: "Rebound",
                            },
                            {
                              key: "assists" as const,
                              label: "Assist",
                            },
                            {
                              key: "steals" as const,
                              label: "Steal",
                            },
                            {
                              key: "blocks" as const,
                              label: "Block",
                            },
                            {
                              key: "turnovers" as const,
                              label: "Turnover",
                            },
                          ].map((item) => (
                            <label
                              key={item.key}
                              className="block"
                            >
                              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                {item.label}
                              </span>

                              <input
                                type="number"
                                step={0.1}
                                value={
                                  nbaScoring[
                                    item.key
                                  ]
                                }
                                onChange={(event) =>
                                  setNbaScoring(
                                    (current) => ({
                                      ...current,

                                      [item.key]:
                                        Number(
                                          event.target.value ||
                                            0,
                                        ),
                                    }),
                                  )
                                }
                                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                              />
                            </label>
                          ))}

                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              void saveScoringRules(
                                "nba",
                              )
                            }
                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                          >
                            Save scoring
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}


                  {rulesSport ===
                    "nfl" &&
                  nflLeague?.is_enabled ? (
                    <>
                      <div className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">
                              Roster
                            </div>

                            <p className="mt-0.5 text-xs text-slate-500">
                              Configure the standard NFL lineup.
                            </p>
                          </div>

                          <div className="text-xs font-semibold text-slate-500">
                            {Object.values(
                              nflRoster,
                            ).reduce(
                              (
                                total,
                                count,
                              ) =>
                                total +
                                count,
                              0,
                            )}{" "}
                            total
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                          {[
                            "QB",
                            "RB",
                            "WR",
                            "TE",
                            "K",
                            "FLEX",
                            "SF",
                            "D/ST",
                          ].map(
                            (
                              position,
                            ) => (
                              <label
                                key={
                                  position
                                }
                                className="block"
                              >
                                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                  {
                                    position
                                  }
                                </span>

                                <input
                                  type="number"
                                  min={0}
                                  max={20}
                                  step={1}
                                  value={
                                    nflRoster[
                                      position as keyof typeof nflRoster
                                    ]
                                  }
                                  onChange={(
                                    event,
                                  ) =>
                                    setNflRoster(
                                      (
                                        current,
                                      ) => ({
                                        ...current,

                                        [position]:
                                          Math.max(
                                            0,
                                            Math.min(
                                              20,
                                              Number(
                                                event
                                                  .target
                                                  .value ||
                                                  0,
                                              ),
                                            ),
                                          ),
                                      }),
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                                />
                              </label>
                            ),
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={
                              saving ||
                              Object.values(
                                nflRoster,
                              ).reduce(
                                (
                                  total,
                                  count,
                                ) =>
                                  total +
                                  count,
                                0,
                              ) <
                                1
                            }
                            onClick={() =>
                              void saveNflRosterRules()
                            }
                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                          >
                            Save roster
                          </button>

                          <span className="text-xs text-slate-400">
                            FLEX accepts RB/WR/TE · SF also accepts QB.
                          </span>
                        </div>
                      </div>


                      <div className="border-t border-slate-200 px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold">
                            Scoring
                        </div>

                        <p className="mt-0.5 text-xs text-slate-500">
                          Scoring changes apply to new slates only. Existing slates retain their frozen rules.
                        </p>
                      </div>

                      <div className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                        Offense
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        {[
                          {
                            key: "passingYards" as const,
                            label: "Passing yard",
                            step: 0.01,
                          },
                          {
                            key: "passingTouchdowns" as const,
                            label: "Passing TD",
                            step: 0.5,
                          },
                          {
                            key: "passingInterceptions" as const,
                            label: "Interception",
                            step: 0.5,
                          },
                          {
                            key: "rushingYards" as const,
                            label: "Rushing yard",
                            step: 0.01,
                          },
                          {
                            key: "rushingTouchdowns" as const,
                            label: "Rushing TD",
                            step: 0.5,
                          },
                          {
                            key: "receivingYards" as const,
                            label: "Receiving yard",
                            step: 0.01,
                          },
                          {
                            key: "receivingTouchdowns" as const,
                            label: "Receiving TD",
                            step: 0.5,
                          },
                          {
                            key: "receptions" as const,
                            label: "Reception",
                            step: 0.5,
                          },
                          {
                            key: "fumblesLost" as const,
                            label: "Fumble lost",
                            step: 0.5,
                          },
                        ].map((item) => (
                          <label
                            key={item.key}
                            className="block"
                          >
                            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                              {item.label}
                            </span>

                            <input
                              type="number"
                              step={item.step}
                              value={
                                nflScoring[
                                  item.key
                                ]
                              }
                              onChange={(event) =>
                                setNflScoring(
                                  (current) => ({
                                    ...current,

                                    [item.key]:
                                      Number(
                                        event.target.value ||
                                          0,
                                      ),
                                  }),
                                )
                              }
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                            />
                          </label>
                        ))}
                      </div>

                      <div className="mt-5 border-t border-slate-200 pt-4">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Defense / Special Teams
                        </div>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                          {[
                            { key: "dstSacks" as const, label: "Sack" },
                            { key: "dstInterceptions" as const, label: "Interception" },
                            { key: "dstFumbleRecoveries" as const, label: "Fumble recovery" },
                            { key: "dstSafeties" as const, label: "Safety" },
                            { key: "dstTouchdowns" as const, label: "Defensive/ST TD" },
                          ].map((item) => (
                            <label key={item.key} className="block">
                              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                {item.label}
                              </span>

                              <input
                                type="number"
                                step={0.5}
                                value={getNflScoringInputValue(
                                  nflScoring,
                                  item.key,
                                )}
                                onChange={(event) =>
                                  setNflScoring((current) => ({
                                    ...current,
                                    [item.key]: Number(event.target.value || 0),
                                  }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                              />
                            </label>
                          ))}
                        </div>

                        <div className="mt-4 text-xs font-semibold text-slate-600">
                          Points allowed
                        </div>

                        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                          {[
                            { key: "dstPointsAllowed0" as const, label: "0" },
                            { key: "dstPointsAllowed1To6" as const, label: "1–6" },
                            { key: "dstPointsAllowed7To13" as const, label: "7–13" },
                            { key: "dstPointsAllowed14To20" as const, label: "14–20" },
                            { key: "dstPointsAllowed21To27" as const, label: "21–27" },
                            { key: "dstPointsAllowed28To34" as const, label: "28–34" },
                            { key: "dstPointsAllowed35Plus" as const, label: "35+" },
                          ].map((item) => (
                            <label key={item.key} className="block">
                              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                {item.label}
                              </span>

                              <input
                                type="number"
                                step={0.5}
                                value={getNflScoringInputValue(
                                  nflScoring,
                                  item.key,
                                )}
                                onChange={(event) =>
                                  setNflScoring((current) => ({
                                    ...current,
                                    [item.key]: Number(event.target.value || 0),
                                  }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                              />
                            </label>
                          ))}
                        </div>

                        <div className="mt-4 text-xs font-semibold text-slate-600">
                          Yards allowed
                        </div>

                        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                          {[
                            { key: "dstYardsAllowedUnder100" as const, label: "Under 100" },
                            { key: "dstYardsAllowed100To199" as const, label: "100–199" },
                            { key: "dstYardsAllowed200To299" as const, label: "200–299" },
                            { key: "dstYardsAllowed300To349" as const, label: "300–349" },
                            { key: "dstYardsAllowed350To399" as const, label: "350–399" },
                            { key: "dstYardsAllowed400To449" as const, label: "400–449" },
                            { key: "dstYardsAllowed450Plus" as const, label: "450+" },
                          ].map((item) => (
                            <label key={item.key} className="block">
                              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                {item.label}
                              </span>

                              <input
                                type="number"
                                step={0.5}
                                value={getNflScoringInputValue(
                                  nflScoring,
                                  item.key,
                                )}
                                onChange={(event) =>
                                  setNflScoring((current) => ({
                                    ...current,
                                    [item.key]: Number(event.target.value || 0),
                                  }))
                                }
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-500"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void saveScoringRules(
                              "nfl",
                            )
                          }
                          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Save scoring
                        </button>

                        <span className="text-xs text-slate-400">
                          Current defaults are standard PPR scoring.
                        </span>
                      </div>
                    </div>
                    </>
                  ) : null}


                  {rulesSport ===
                  "golf" ? (
                    <div className="px-4 py-5">
                      <div className="text-sm font-semibold">
                        ⛳ Golf
                      </div>

                      <p className="mt-1 max-w-2xl text-sm text-slate-500">
                        Golf currently uses slate-level golfer counts and scoring settings. Commissioner-level Golf rules will be added when we return to the expanded Golf game modes after Groups launches.
                      </p>
                    </div>
                  ) : null}
                </section>
                ) : null}


                {settingsTab ===
                "members" ? (
                  <>
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                        <div>
                          <h2 className="font-semibold">
                            Members
                      </h2>

                      <p className="text-xs text-slate-500">
                        Group roles control commissioner access only inside this Group.
                      </p>
                    </div>

                    <input
                      value={memberSearch}
                      onChange={(event) =>
                        setMemberSearch(
                          event.target.value,
                        )
                      }
                      placeholder="Search members…"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 sm:w-64"
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">
                            Member
                          </th>

                          <th className="px-4 py-2.5">
                            Email
                          </th>

                          <th className="px-4 py-2.5">
                            Team
                          </th>

                          <th className="px-4 py-2.5">
                            Role
                          </th>

                          <th className="px-4 py-2.5">
                            Status
                          </th>

                          <th className="px-4 py-2.5">
                            Joined
                          </th>

                          <th className="px-4 py-2.5 text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {activeMembers.map(
                          (member) => (
                            <tr
                              key={member.id}
                              className="border-t border-slate-100"
                            >
                              <td className="px-4 py-3">
                                <div className="font-semibold">
                                  {member.display_name}
                                </div>

                                {member.system_role ===
                                "super_admin" ? (
                                  <div className="mt-0.5 text-[11px] font-bold text-violet-600">
                                    SUPER ADMIN
                                  </div>
                                ) : null}
                              </td>

                              <td className="px-4 py-3 text-slate-500">
                                {member.email ??
                                  "Not linked"}
                              </td>

                              <td className="px-4 py-3">
                                {member.team?.name ??
                                  "—"}
                              </td>

                              <td className="px-4 py-3">
                                <select
                                  value={member.role}
                                  disabled={
                                    saving ||
                                    !member.is_active
                                  }
                                  onChange={(event) =>
                                    void updateMemberRole(
                                      member,
                                      event.target.value as
                                        | "member"
                                        | "admin",
                                    )
                                  }
                                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                                >
                                  <option value="member">
                                    Member
                                  </option>

                                  <option value="admin">
                                    Admin
                                  </option>
                                </select>
                              </td>

                              <td className="px-4 py-3">
                                <span
                                  className={`rounded-full border px-2 py-1 text-[11px] font-bold ${
                                    member.is_active
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-slate-200 bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {member.is_active
                                    ? "ACTIVE"
                                    : "INACTIVE"}
                                </span>
                              </td>

                              <td className="px-4 py-3 text-slate-500">
                                {formatDate(
                                  member.joined_at,
                                )}
                              </td>

                              <td className="px-4 py-3 text-right">
                                {member.is_active &&
                                member.user_id !==
                                  data?.currentUser?.id ? (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() =>
                                      void removeMember(
                                        member,
                                      )
                                    }
                                    className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>


                {inactiveMemberCount >
                0 ? (
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() =>
                        setShowInactiveMembers(
                          (current) =>
                            !current,
                        )
                      }
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <div>
                        <div className="font-semibold">
                          Former / Inactive Members
                          {" "}
                          <span className="text-slate-400">
                            ({inactiveMemberCount})
                          </span>
                        </div>

                        <div className="mt-0.5 text-xs text-slate-500">
                          Removed members are retained for Group history.
                        </div>
                      </div>

                      <span className="text-sm font-bold text-slate-400">
                        {showInactiveMembers
                          ? "▲"
                          : "▼"}
                      </span>
                    </button>


                    {showInactiveMembers ? (
                      <div className="overflow-x-auto border-t border-slate-200">
                        <table className="w-full min-w-[760px] text-left text-sm">
                          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-2.5">
                                Member
                              </th>

                              <th className="px-4 py-2.5">
                                Email
                              </th>

                              <th className="px-4 py-2.5">
                                Team
                              </th>

                              <th className="px-4 py-2.5">
                                Role
                              </th>

                              <th className="px-4 py-2.5">
                                Joined
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {inactiveMembers.length ===
                            0 ? (
                              <tr>
                                <td
                                  colSpan={5}
                                  className="px-4 py-6 text-center text-sm text-slate-500"
                                >
                                  No inactive members match your search.
                                </td>
                              </tr>
                            ) : (
                              inactiveMembers.map(
                                (member) => (
                                  <tr
                                    key={member.id}
                                    className="border-t border-slate-100"
                                  >
                                    <td className="px-4 py-3">
                                      <div className="font-semibold text-slate-600">
                                        {member.display_name}
                                      </div>

                                      <div className="mt-1 inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                        INACTIVE
                                      </div>
                                    </td>

                                    <td className="px-4 py-3 text-slate-500">
                                      {member.email ??
                                        "Not linked"}
                                    </td>

                                    <td className="px-4 py-3 text-slate-500">
                                      {member.team?.name ??
                                        "—"}
                                    </td>

                                    <td className="px-4 py-3 text-slate-500">
                                      {member.role ===
                                      "admin"
                                        ? "Admin"
                                        : "Member"}
                                    </td>

                                    <td className="px-4 py-3 text-slate-500">
                                      {formatDate(
                                        member.joined_at,
                                      )}
                                    </td>
                                  </tr>
                                ),
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </section>
                ) : null}


                  </>
                ) : null}


                {settingsTab ===
                "invites" ? (
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-semibold">
                            Invitations
                        </h2>

                        <p className="text-xs text-slate-500">
                          Email-specific invites expire after seven days.
                        </p>
                      </div>

                      <div className="flex w-full gap-2 sm:w-auto">
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(event) =>
                            setInviteEmail(
                              event.target.value,
                            )
                          }
                          placeholder="person@example.com"
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 sm:w-64"
                        />

                        <button
                          type="button"
                          disabled={
                            saving ||
                            !inviteEmail.trim()
                          }
                          onClick={() =>
                            void createInvite(
                              inviteEmail,
                            )
                          }
                          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Invite
                        </button>
                      </div>
                    </div>
                  </div>


                  {latestInviteUrl ? (
                    <div className="border-b border-sky-200 bg-sky-50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-sky-800">
                            Fresh link · {latestInviteEmail}
                          </div>

                          <div className="mt-1 truncate font-mono text-xs text-slate-600">
                            {latestInviteUrl}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void copyInviteUrl()
                          }
                          className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white"
                        >
                          Copy link
                        </button>
                      </div>
                    </div>
                  ) : null}


                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
                    <input
                      value={inviteSearch}
                      onChange={(event) =>
                        setInviteSearch(
                          event.target.value,
                        )
                      }
                      placeholder="Search invitations…"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500 sm:w-64"
                    />

                    <div className="text-xs text-slate-400">
                      {filteredInvites.length} shown
                    </div>
                  </div>


                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[950px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">
                            Email
                          </th>

                          <th className="px-4 py-2.5">
                            Status
                          </th>

                          <th className="px-4 py-2.5">
                            Created
                          </th>

                          <th className="px-4 py-2.5">
                            Expires
                          </th>

                          <th className="px-4 py-2.5 text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredInvites.length ===
                        0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-4 py-6 text-center text-sm text-slate-500"
                            >
                              No matching invitations.
                            </td>
                          </tr>
                        ) : (
                          filteredInvites.map(
                            (invite) => (
                              <tr
                                key={invite.id}
                                className="border-t border-slate-100"
                              >
                                <td className="px-4 py-3 font-medium">
                                  {invite.email}
                                </td>

                                <td className="px-4 py-3">
                                  <span
                                    className={`rounded-full border px-2 py-1 text-[11px] font-bold uppercase ${inviteStatusClass(
                                      invite.status,
                                    )}`}
                                  >
                                    {invite.status}
                                  </span>
                                </td>

                                <td className="px-4 py-3 text-slate-500">
                                  {formatDate(
                                    invite.created_at,
                                  )}
                                </td>

                                <td className="px-4 py-3 text-slate-500">
                                  {formatDate(
                                    invite.expires_at,
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {invite.status ===
                                  "pending" ? (
                                    <div className="flex justify-end gap-2">
                                      <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() =>
                                          void createInvite(
                                            invite.email,
                                          )
                                        }
                                        className="rounded-lg border border-sky-300 px-2.5 py-1.5 text-xs font-bold text-sky-700"
                                      >
                                        Reissue
                                      </button>

                                      <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() =>
                                          void revokeInvite(
                                            invite,
                                          )
                                        }
                                        className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600"
                                      >
                                        Revoke
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-400">
                                      —
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ),
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                  </section>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
