export type AdminMenuLink = {
  href: string;
  label: string;
};

export type AdminMenuGroup = {
  label: string;
  links: AdminMenuLink[];
};


function getAdminOverviewGroup(
  isSuperAdmin: boolean,
): AdminMenuGroup {
  return {
    label: "Overview",
    links: [
      {
        href: "/admin",
        label: "Commissioner Center",
      },
      ...(isSuperAdmin
        ? [
            {
              href: "/admin/platform",
              label: "Super Admin Center",
            },
          ]
        : []),
    ],
  };
}


const NOTIFICATIONS: AdminMenuGroup = {
  label: "Notifications",
  links: [
    {
      href: "/admin/notification-templates",
      label: "Notification Templates",
    },
    {
      href: "/admin/notification-history",
      label: "Notification History",
    },
  ],
};


export function getAdminMenuGroups(
  sport: string,
  isSuperAdmin = false,
): AdminMenuGroup[] {
  const adminOverview =
    getAdminOverviewGroup(
      isSuperAdmin,
    );
  if (sport === "nba-skins") {
    return [
      adminOverview,
    ];
  }


  if (sport === "ncaa") {
    return [
      adminOverview,
      {
        label: "Pick 'Em",
        links: [
          {
            href: "/admin/ncaa-pickem",
            label: "NCAA Pick 'Em",
          },
        ],
      },
      NOTIFICATIONS,
    ];
  }


  if (sport === "nfl") {
    return [
      adminOverview,
      {
        label: "Slates",
        links: [
          {
            href: "/slates/new",
            label: "Create Slate",
          },
          {
            href: "/admin/slates",
            label: "Manage Slates",
          },
          {
            href: "/admin/corrections",
            label: "Corrections",
          },
        ],
      },
      NOTIFICATIONS,
      {
        label: "Players & League",
        links: [
          {
            href: "/admin/players-nfl",
            label: "Manage NFL Players",
          },
          {
            href: "/admin/league-awards",
            label: "League Awards",
          },
        ],
      },
    ];
  }


  if (sport === "golf") {
    return [
      adminOverview,
      {
        label: "Slates",
        links: [
          {
            href: "/slates/new",
            label: "Create Slate",
          },
          {
            href: "/admin/slates",
            label: "Manage Slates",
          },
          {
            href: "/admin/corrections",
            label: "Corrections",
          },
        ],
      },
      NOTIFICATIONS,
      {
        label: "League",
        links: [
          {
            href: "/admin/league-awards",
            label: "League Awards",
          },
        ],
      },
    ];
  }


  /*
   * NBA fantasy.
   */
  return [
    adminOverview,
    {
      label: "Slates",
      links: [
        {
          href: "/slates/new",
          label: "Create Slate",
        },
        {
          href: "/admin/slates",
          label: "Manage Slates",
        },
        {
          href: "/admin/slate-games",
          label: "Slate NBA Games",
        },
        {
          href: "/admin/corrections",
          label: "Corrections",
        },
      ],
    },
    NOTIFICATIONS,
    {
      label: "Players & League",
      links: [
        {
          href: "/admin/players",
          label: "Manage NBA Players",
        },
        {
          href: "/admin/league-awards",
          label: "League Awards",
        },
      ],
    },
  ];
}
