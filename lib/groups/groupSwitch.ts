export type GroupNavigationLocation = {
  pathname: string;
  search: string;
};


export type PendingGroupSwitch<T> = {
  requestedGroupSlug: string;
  sourceLocation: GroupNavigationLocation;
  target: T | null;
  destination: string | null;
  requiresNavigationAcknowledgement: boolean;
  navigationState: "preparing" | "pending" | "same_route";
};


type GroupContextRefreshInput<T> = {
  fetchContext: () => Promise<T>;
  commitContext: (context: T) => void;
};


function normalizedSearchEntries(
  search: string,
) {
  return Array.from(
    new URLSearchParams(
      search,
    ).entries(),
  ).sort(
    ([firstKey, firstValue], [secondKey, secondValue]) =>
      firstKey.localeCompare(secondKey) ||
      firstValue.localeCompare(secondValue),
  );
}


export function navigationLocationsMatch(
  first: GroupNavigationLocation,
  second: GroupNavigationLocation,
) {
  if (
    first.pathname !==
    second.pathname
  ) {
    return false;
  }

  return JSON.stringify(
    normalizedSearchEntries(
      first.search,
    ),
  ) === JSON.stringify(
    normalizedSearchEntries(
      second.search,
    ),
  );
}


export function locationFromDestination(
  destination: string,
) {
  const parsed =
    new URL(
      destination,
      "https://111sports.local",
    );

  return {
    pathname:
      parsed.pathname,

    search:
      parsed.search,
  } satisfies GroupNavigationLocation;
}


export function createPendingGroupSwitch<T>({
  requestedGroupSlug,
  sourceLocation,
}: {
  requestedGroupSlug: string;
  sourceLocation: GroupNavigationLocation;
}): PendingGroupSwitch<T> {
  return {
    requestedGroupSlug,
    sourceLocation,
    target: null,
    destination: null,
    requiresNavigationAcknowledgement: false,
    navigationState: "preparing",
  };
}


export function resolvePendingGroupSwitch<T>({
  pending,
  target,
  destination,
}: {
  pending: PendingGroupSwitch<T>;
  target: T;
  destination: string;
}): PendingGroupSwitch<T> {
  const requiresNavigationAcknowledgement =
    !navigationLocationsMatch(
      pending.sourceLocation,
      locationFromDestination(
        destination,
      ),
    );

  return {
    ...pending,
    target,
    destination,
    requiresNavigationAcknowledgement:
      requiresNavigationAcknowledgement,
    navigationState:
      requiresNavigationAcknowledgement
        ? "pending"
        : "same_route",
  };
}


export function pendingSwitchAcknowledged<T>(
  pending: PendingGroupSwitch<T>,
  currentLocation: GroupNavigationLocation,
) {
  if (
    !pending.requiresNavigationAcknowledgement ||
    !pending.destination ||
    !pending.target
  ) {
    return false;
  }

  return navigationLocationsMatch(
    currentLocation,
    locationFromDestination(
      pending.destination,
    ),
  );
}


export function shouldRenderGroupSwitchShell<T>(
  pending: PendingGroupSwitch<T> | null,
) {
  return pending !== null;
}


export async function executeGroupContextRefresh<T>({
  fetchContext,
  commitContext,
}: GroupContextRefreshInput<T>) {
  const context =
    await fetchContext();

  commitContext(
    context,
  );

  return context;
}


export function getGroupContextKey(
  context:
    | {
        group?: {
          id?: string;
        };
      }
    | null,
) {
  return context?.group?.id ??
    "no-active-group";
}
