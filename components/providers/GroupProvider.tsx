"use client";

import {
  createContext,
  Fragment,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  getGroupSwitchDestination,
} from "@/lib/groups/navigation";

import {
  createPendingGroupSwitch,
  executeGroupContextRefresh,
  getGroupContextKey,
  pendingSwitchAcknowledged,
  resolvePendingGroupSwitch,
  shouldRenderGroupSwitchShell,
  type GroupNavigationLocation,
  type PendingGroupSwitch,
} from "@/lib/groups/groupSwitch";

import {
  sportKeyFromLeagueSportKey,
} from "@/lib/sports";


export type ClientAvailableGroup = {
  id: string;
  name: string;
  slug: string;

  role:
    | "member"
    | "admin";

  isActive: boolean;
};


export type ClientGroupLeague = {
  id: string;
  sportKey: string;
  gameMode: string;
  name: string;
  slug: string;
  isEnabled: boolean;
  settingsVersion: number;
  settings: Record<string, unknown>;
};


export type ClientGroupContext = {
  group: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
  };

  membership: {
    id: string;

    role:
      | "member"
      | "admin";

    isActive: boolean;
  };

  team: {
    id: number;
    name: string;
    displayOrder: number | null;
  } | null;

  leagues:
    ClientGroupLeague[];

  isGroupAdmin: boolean;
  isSuperAdmin: boolean;
  canAdministerGroup: boolean;
};


type GroupProviderValue = {
  groupContext:
    ClientGroupContext | null;

  availableGroups:
    ClientAvailableGroup[];

  isLoading:
    boolean;

  isSwitchingGroup:
    boolean;

  refreshGroupContext:
    () => Promise<ClientGroupContext | null>;

  setActiveGroup:
    (
      groupSlug: string,
    ) => Promise<void>;
};


type GroupContextPayload = {
  context: ClientGroupContext | null;
  groups: ClientAvailableGroup[];
};


const GroupContext =
  createContext<
    GroupProviderValue | undefined
  >(
    undefined,
  );


function GroupLocationObserver({
  onChange,
}: {
  onChange: (
    location: GroupNavigationLocation,
  ) => void;
}) {
  const pathname =
    usePathname();

  const searchParams =
    useSearchParams();

  const search =
    searchParams.toString();

  useEffect(
    () => {
      onChange({
        pathname,
        search:
          search
            ? `?${search}`
            : "",
      });
    },
    [
      onChange,
      pathname,
      search,
    ],
  );

  return null;
}


function GroupSwitchingShell() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-teal-300" />
        <p className="mt-4 text-sm font-semibold text-teal-200">
          Switching Group…
        </p>
      </div>
    </main>
  );
}


export default function GroupProvider({
  children,
}: {
  children:
    React.ReactNode;
}) {
  const router =
    useRouter();

  const [
    groupContext,
    setGroupContext,
  ] =
    useState<
      ClientGroupContext | null
    >(
      null,
    );

  const [
    availableGroups,
    setAvailableGroups,
  ] =
    useState<
      ClientAvailableGroup[]
    >(
      [],
    );

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(
      true,
    );

  const [
    isSwitchingGroup,
    setIsSwitchingGroup,
  ] =
    useState(
      false,
    );

  const [
    pendingGroupSwitch,
    setPendingGroupSwitch,
  ] =
    useState<
      PendingGroupSwitch<GroupContextPayload> | null
    >(
      null,
    );

  const [
    currentLocation,
    setCurrentLocation,
  ] =
    useState<GroupNavigationLocation | null>(
      null,
    );


  const fetchGroupContext =
    useCallback(
      async () => {
        const response =
          await fetch(
            "/api/groups/context",
            {
              cache:
                "no-store",
            },
          );


        if (
          response.status ===
          401
        ) {
          return {
            context: null,
            groups: [],
          } satisfies GroupContextPayload;
        }


        const result =
          await response.json();


        if (
          !response.ok
        ) {
          throw new Error(
            result?.error ??
              "Failed to load Group context.",
          );
        }


        const nextContext =
          result.context ??
            null;

        if (
          nextContext &&
          (
            typeof nextContext !== "object" ||
            typeof nextContext.group?.id !== "string" ||
            typeof nextContext.group?.slug !== "string" ||
            !Array.isArray(nextContext.leagues) ||
            typeof nextContext.canAdministerGroup !== "boolean" ||
            typeof nextContext.isSuperAdmin !== "boolean"
          )
        ) {
          throw new Error(
            "Group context response is invalid.",
          );
        }

        return {
          context:
            nextContext as ClientGroupContext | null,

          groups:
            Array.isArray(
              result.groups,
            )
              ? result.groups
              : [],
        } as GroupContextPayload;
      },
      [],
    );


  const commitGroupContext =
    useCallback(
      (
        payload:
          GroupContextPayload,
      ) => {
        setGroupContext(
          payload.context,
        );

        setAvailableGroups(
          payload.groups,
        );
      },
      [],
    );


  const loadContext =
    useCallback(
      async () => {
        try {
          const payload =
            await executeGroupContextRefresh({
              fetchContext:
                fetchGroupContext,

              commitContext:
                commitGroupContext,
            });

          return payload.context;
        } catch (
          error
        ) {
          console.error(
            "Failed to load Group context",
            error,
          );

          commitGroupContext({
            context: null,
            groups: [],
          });

          return null;
        } finally {
          setIsLoading(
            false,
          );
        }
      },
      [
        commitGroupContext,
        fetchGroupContext,
      ],
    );


  useEffect(
    () => {
      // Loading remote context on mount intentionally commits async state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadContext();
    },
    [
      loadContext,
    ],
  );


  useEffect(
    () => {
      if (
        !pendingGroupSwitch ||
        !currentLocation ||
        !pendingSwitchAcknowledged(
          pendingGroupSwitch,
          currentLocation,
        ) ||
        !pendingGroupSwitch.target
      ) {
        return;
      }

      // Route acknowledgement intentionally commits the pending external context.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      commitGroupContext(
        pendingGroupSwitch.target,
      );

      setPendingGroupSwitch(
        null,
      );

      setIsSwitchingGroup(
        false,
      );
    },
    [
      commitGroupContext,
      currentLocation,
      pendingGroupSwitch,
    ],
  );


  const setActiveGroup =
    useCallback(
      async (
        groupSlug:
          string,
      ) => {
        if (
          !groupSlug ||
          groupSlug ===
            groupContext?.group.slug
        ) {
          return;
        }

        const sourceGroupSlug =
          groupContext?.group.slug ??
          null;

        let activeGroupChanged =
          false;

        try {
          setIsSwitchingGroup(
            true,
          );

          const sourceLocation = {
            pathname:
              window.location.pathname,

            search:
              window.location.search,
          } satisfies GroupNavigationLocation;

          const initialPending =
            createPendingGroupSwitch<GroupContextPayload>({
              requestedGroupSlug:
                groupSlug,

              sourceLocation,
            });

          setPendingGroupSwitch(
            initialPending,
          );

          const response =
            await fetch(
              "/api/groups/active",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    groupSlug,
                  }),
              },
            );

          const result =
            await response.json();

          if (
            !response.ok
          ) {
            throw new Error(
              result?.error ??
              "Failed to switch Group.",
            );
          }

          activeGroupChanged =
            true;

          const targetPayload =
            await fetchGroupContext();

          const targetContext =
            targetPayload.context;

          if (
            !targetContext ||
            targetContext.group.slug !== groupSlug
          ) {
            throw new Error(
              "Failed to load the selected Group context.",
            );
          }

          const enabledSports =
            targetContext.leagues
              .filter(
                (league) =>
                  league.isEnabled,
              )
              .map(
                (league) =>
                  sportKeyFromLeagueSportKey(
                    league.sportKey,
                  ),
              );

          const destination =
            getGroupSwitchDestination({
              pathname:
                sourceLocation.pathname,

              search:
                sourceLocation.search,

              targetGroupSlug:
                targetContext.group.slug,

              enabledSports,

              canAdministerGroup:
                targetContext.canAdministerGroup,

              isSuperAdmin:
                targetContext.isSuperAdmin,
            });

          const resolvedPending =
            resolvePendingGroupSwitch({
              pending:
                initialPending,

              target:
                targetPayload,

              destination,
            });

          setPendingGroupSwitch(
            resolvedPending,
          );

          router.replace(
            destination,
          );

          if (
            !resolvedPending.requiresNavigationAcknowledgement
          ) {
            commitGroupContext(
              targetPayload,
            );

            setPendingGroupSwitch(
              null,
            );

            setIsSwitchingGroup(
              false,
            );
          }
        } catch (
          error
        ) {
          if (
            activeGroupChanged &&
            sourceGroupSlug
          ) {
            try {
              const restoreResponse =
                await fetch(
                "/api/groups/active",
                {
                  method:
                    "POST",

                  headers: {
                    "Content-Type":
                      "application/json",
                  },

                  body:
                    JSON.stringify({
                      groupSlug:
                        sourceGroupSlug,
                    }),
                },
              );

              if (
                !restoreResponse.ok
              ) {
                throw new Error(
                  "Previous Group restoration failed.",
                );
              }
            } catch (
              restoreError
            ) {
              console.error(
                "Failed to restore the previous Group after a switch error",
                restoreError,
              );
            }
          }

          setPendingGroupSwitch(
            null,
          );

          setIsSwitchingGroup(
            false,
          );

          throw error;
        }
      },
      [
        groupContext?.group.slug,
        commitGroupContext,
        fetchGroupContext,
        router,
      ],
    );


  const value =
    useMemo(
      () => ({
        groupContext,
        availableGroups,
        isLoading,
        isSwitchingGroup,
        refreshGroupContext:
          loadContext,
        setActiveGroup,
      }),
      [
        groupContext,
        availableGroups,
        isLoading,
        isSwitchingGroup,
        loadContext,
        setActiveGroup,
      ],
    );


  return (
    <GroupContext.Provider
      value={
        value
      }
    >
      <Suspense fallback={null}>
        <GroupLocationObserver
          onChange={
            setCurrentLocation
          }
        />
      </Suspense>

      {shouldRenderGroupSwitchShell(
        pendingGroupSwitch,
      ) ? (
        <GroupSwitchingShell />
      ) : (
        <Fragment
          key={
            getGroupContextKey(
              groupContext,
            )
          }
        >
          {children}
        </Fragment>
      )}
    </GroupContext.Provider>
  );
}


export function useGroupContext() {
  const context =
    useContext(
      GroupContext,
    );

  if (!context) {
    throw new Error(
      "useGroupContext must be used within GroupProvider",
    );
  }

  return context;
}
