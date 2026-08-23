"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";


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
    () => Promise<void>;

  setActiveGroup:
    (
      groupSlug: string,
    ) => Promise<void>;
};


const GroupContext =
  createContext<
    GroupProviderValue | undefined
  >(
    undefined,
  );


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


  const loadContext =
    useCallback(
      async () => {
        try {
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
            setGroupContext(
              null,
            );

            setAvailableGroups(
              [],
            );

            return;
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


          setGroupContext(
            result.context ??
              null,
          );

          setAvailableGroups(
            Array.isArray(
              result.groups,
            )
              ? result.groups
              : [],
          );
        } catch (
          error
        ) {
          console.error(
            "Failed to load Group context",
            error,
          );

          setGroupContext(
            null,
          );

          setAvailableGroups(
            [],
          );
        } finally {
          setIsLoading(
            false,
          );
        }
      },
      [],
    );


  useEffect(
    () => {
      void loadContext();
    },
    [
      loadContext,
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

        try {
          setIsSwitchingGroup(
            true,
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


          await loadContext();

          router.push(
            `${window.location.pathname}${window.location.search}`,
          );

          router.refresh();
        } finally {
          setIsSwitchingGroup(
            false,
          );
        }
      },
      [
        groupContext?.group.slug,
        loadContext,
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
      {children}
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
