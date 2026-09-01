import { getGroupSwitchDestination } from "./navigation";

export const APP_RESUME_STORAGE_KEY = "111-last-location";

export type AppResumeRecord = {
  version: 1;
  groupSlug: string;
  destination: string;
};

type ResumeGroupContext = {
  groupSlug: string;
  enabledSports: Iterable<string>;
  canAdministerGroup: boolean;
  isSuperAdmin?: boolean;
};

type AppBootState = {
  location: string;
  standalone: boolean;
  navigationType: string | null;
};

function groupHome(groupSlug: string) {
  return `/groups/${encodeURIComponent(groupSlug)}`;
}

function parseDestination(destination: string) {
  if (!destination.startsWith("/") || destination.startsWith("//")) {
    return null;
  }

  const url = new URL(destination, "https://111sports.app");
  return {
    pathname: url.pathname,
    search: url.search,
    destination: `${url.pathname}${url.search}`,
  };
}

export function shouldRestoreStandaloneBoot({
  location,
  standalone,
  navigationType,
}: AppBootState) {
  return standalone && location === "/" && navigationType === "navigate";
}

export function createAppResumeRecord(
  destination: string,
  context: ResumeGroupContext,
): AppResumeRecord | null {
  const parsed = parseDestination(destination);
  if (!parsed) return null;

  const validated = getGroupSwitchDestination({
    pathname: parsed.pathname,
    search: parsed.search,
    targetGroupSlug: context.groupSlug,
    enabledSports: context.enabledSports,
    canAdministerGroup: context.canAdministerGroup,
    isSuperAdmin: context.isSuperAdmin,
  });

  if (validated !== parsed.destination) return null;

  return {
    version: 1,
    groupSlug: context.groupSlug,
    destination: parsed.destination,
  };
}

export function parseAppResumeRecord(value: string | null) {
  if (!value) return null;

  try {
    const candidate = JSON.parse(value) as Partial<AppResumeRecord>;
    const parsed = parseDestination(String(candidate.destination ?? ""));
    const groupSlug = String(candidate.groupSlug ?? "").trim();

    if (candidate.version !== 1 || !groupSlug || !parsed) return null;

    return {
      version: 1,
      groupSlug,
      destination: parsed.destination,
    } satisfies AppResumeRecord;
  } catch {
    return null;
  }
}

export function resolveAppResumeDestination(
  record: AppResumeRecord | null,
  context: ResumeGroupContext,
) {
  const fallback = groupHome(context.groupSlug);

  if (!record || record.groupSlug !== context.groupSlug) {
    return fallback;
  }

  const parsed = parseDestination(record.destination);
  if (!parsed) return fallback;

  return getGroupSwitchDestination({
    pathname: parsed.pathname,
    search: parsed.search,
    targetGroupSlug: context.groupSlug,
    enabledSports: context.enabledSports,
    canAdministerGroup: context.canAdministerGroup,
    isSuperAdmin: context.isSuperAdmin,
  });
}
