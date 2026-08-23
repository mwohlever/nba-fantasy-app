"use client";

import Link from "next/link";

import AppNav from "@/components/AppNav";
import NbaSkinsAdminPage from "@/app/admin/nba-skins/page";

import {
  useSelectedSport,
} from "@/components/providers/SportProvider";

import {
  getSportConfig,
} from "@/lib/sports";

type AdminCard = {
  href: string;
  title: string;
  description: string;
};

type AdminGroup = {
  title: string;
  description: string;
  cards: AdminCard[];
};

const NOTIFICATION_CARDS:
  AdminCard[] = [
    {
      href:
        "/admin/notification-templates",

      title:
        "Notification Controls",

      description:
        "Control notification wording, timing, and sport-specific message settings.",
    },
    {
      href:
        "/admin/notification-history",

      title:
        "Notification Monitor",

      description:
        "Audit delivery results, failures, recipients, devices, and notification diagnostics.",
    },
  ];

const FANTASY_SLATE_CARDS:
  AdminCard[] = [
    {
      href:
        "/slates/new",

      title:
        "Create Slate",

      description:
        "Choose dates, participating teams, and the initial draft order.",
    },
    {
      href:
        "/admin/slates",

      title:
        "Manage Slates",

      description:
        "Edit slate settings, participation, order, lock status, and reseeding.",
    },
    {
      href:
        "/admin/corrections",

      title:
        "Corrections",

      description:
        "Fix historical rosters, stats, totals, and finish positions.",
    },
  ];

function getAdminGroups(
  sport: string,
): AdminGroup[] {
  if (
    sport === "nba-skins"
  ) {
    return [
      {
        title:
          "NBA Skins",
        description:
          "Manage the annual NBA Skins draft, lock state, records, and historical seasons.",
        cards: [
          {
            href:
              "/admin/nba-skins",
            title:
              "NBA Skins Control",
            description:
              "Manage the active season, draft lock, historical import, and team records.",
          },
        ],
      },
    ];
  }

  if (
    sport === "ncaa"
  ) {
    return [
      {
        title:
          "Pick 'Em Operations",

        description:
          "Manage the weekly NCAA Pick 'Em card and commissioner controls.",

        cards: [
          {
            href:
              "/admin/ncaa-pickem",

            title:
              "NCAA Pick 'Em",

            description:
              "Refresh weekly games, choose commissioner-added matchups, and control the weekly lock.",
          },
        ],
      },
      {
        title:
          "Notifications",

        description:
          "Control Pick 'Em reminders and review delivery results.",

        cards:
          NOTIFICATION_CARDS,
      },
    ];
  }

  if (
    sport === "nfl"
  ) {
    return [
      {
        title:
          "Slates & Draft",

        description:
          "Create, configure, and maintain NFL fantasy slates.",

        cards:
          FANTASY_SLATE_CARDS,
      },
      {
        title:
          "Notifications",

        description:
          "Control NFL push notification wording and review delivery results.",

        cards:
          NOTIFICATION_CARDS,
      },
      {
        title:
          "Players & League",

        description:
          "Maintain NFL player records and league settings.",

        cards: [
          {
            href:
              "/admin/players-nfl",

            title:
              "Manage NFL Players",

            description:
              "Edit positions, teams, active status, and availability for NFL players.",
          },
          {
            href:
              "/admin/league-awards",

            title:
              "League Awards",

            description:
              "Create and manage custom seasonal awards for each league member.",
          },
        ],
      },
    ];
  }

  if (
    sport === "golf"
  ) {
    return [
      {
        title:
          "Slates & Draft",

        description:
          "Create, configure, and maintain Golf tournament slates.",

        cards:
          FANTASY_SLATE_CARDS,
      },
      {
        title:
          "Notifications",

        description:
          "Control Golf push notification wording and review delivery results.",

        cards:
          NOTIFICATION_CARDS,
      },
      {
        title:
          "League",

        description:
          "Manage Golf league awards and season recognition.",

        cards: [
          {
            href:
              "/admin/league-awards",

            title:
              "League Awards",

            description:
              "Create and manage custom seasonal awards for each league member.",
          },
        ],
      },
    ];
  }

  /*
   * NBA is the default sport.
   */
  return [
    {
      title:
        "Slates & Draft",

      description:
        "Create, configure, and maintain NBA fantasy slates.",

      cards: [
        {
          href:
            "/slates/new",

          title:
            "Create Slate",

          description:
            "Choose dates, participating teams, and the initial draft order.",
        },
        {
          href:
            "/admin/slates",

          title:
            "Manage Slates",

          description:
            "Edit slate settings, participation, order, lock status, and reseeding.",
        },
        {
          href:
            "/admin/slate-games",

          title:
            "Slate NBA Games",

          description:
            "Attach exact NBA game IDs for reliable multi-day refreshes.",
        },
        {
          href:
            "/admin/corrections",

          title:
            "Corrections",

          description:
            "Fix historical rosters, stats, totals, and finish positions.",
        },
      ],
    },
    {
      title:
        "Notifications",

      description:
        "Control NBA push notification wording and review delivery results.",

      cards:
        NOTIFICATION_CARDS,
    },
    {
      title:
        "Players & League",

      description:
        "Maintain NBA player records and league settings.",

      cards: [
        {
          href:
            "/admin/players",

          title:
            "Manage NBA Players",

          description:
            "Edit names, NBA IDs, teams, active status, and availability.",
        },
        {
          href:
            "/admin/league-awards",

          title:
            "League Awards",

          description:
            "Create and manage custom seasonal awards for each league member.",
        },
      ],
    },
  ];
}

export default function AdminPage() {
  const {
    selectedSport,
    isHydrated,
  } =
    useSelectedSport();

  const sport =
    getSportConfig(
      selectedSport,
    );

  const adminGroups =
    getAdminGroups(
      selectedSport,
    );

  /*
   * NBA Skins has a deliberately small commissioner surface.
   * Show those controls directly on /admin rather than forcing
   * another click through an admin card.
   */
  if (
    isHydrated &&
    selectedSport === "nba-skins"
  ) {
    return (
      <NbaSkinsAdminPage />
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

        {!isHydrated ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
            Loading commissioner controls…
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-600">
                {sport.emoji} {sport.label}
              </div>

              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Commissioner Control Center
              </h1>

              <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                {selectedSport ===
                "ncaa"
                  ? "Manage weekly Pick 'Em games, reminders, and commissioner operations."
                  : `Manage ${sport.label} slates, players, notifications, corrections, and league operations.`}
              </p>
            </section>

            {adminGroups.map(
              (
                group,
              ) => (
                <section
                  key={
                    group.title
                  }
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
                >
                  <h2 className="text-lg font-semibold">
                    {
                      group.title
                    }
                  </h2>

                  <p className="mt-0.5 text-xs leading-5 text-slate-500">
                    {
                      group.description
                    }
                  </p>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {group.cards.map(
                      (
                        card,
                      ) => (
                        <Link
                          key={
                            card.href
                          }
                          href={
                            card.href
                          }
                          className="group rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-sky-300 hover:bg-sky-50 sm:p-4"
                        >
                          <h3 className="font-semibold text-slate-950">
                            {
                              card.title
                            }
                          </h3>

                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            {
                              card.description
                            }
                          </p>

                          <div className="mt-2 text-xs font-semibold text-sky-700">
                            Open →
                          </div>
                        </Link>
                      ),
                    )}
                  </div>
                </section>
              ),
            )}
          </>
        )}
      </div>
    </main>
  );
}
