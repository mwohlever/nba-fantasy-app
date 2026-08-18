export type AdminMenuLink = {
  href: string;
  label: string;
};

export type AdminMenuGroup = {
  label: string;
  links: AdminMenuLink[];
};


const ADMIN_HOME: AdminMenuGroup = {
  label: "Overview",
  links: [
    {
      href: "/admin",
      label: "Admin Home",
    },
  ],
};


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
): AdminMenuGroup[] {
  if (sport === "nba-skins") {
    return [
      ADMIN_HOME,
    ];
  }


  if (sport === "ncaa") {
    return [
      ADMIN_HOME,
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
      ADMIN_HOME,
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
      ADMIN_HOME,
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
    ADMIN_HOME,
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
