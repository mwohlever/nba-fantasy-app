"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";


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

  isLoading: boolean;

  refreshGroupContext:
    () => Promise<void>;
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
    isLoading,
    setIsLoading,
  ] =
    useState(
      true,
    );


  async function loadContext() {
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
    } finally {
      setIsLoading(
        false,
      );
    }
  }


  useEffect(
    () => {
      void loadContext();
    },
    [],
  );


  const value =
    useMemo(
      () => ({
        groupContext,
        isLoading,
        refreshGroupContext:
          loadContext,
      }),
      [
        groupContext,
        isLoading,
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
