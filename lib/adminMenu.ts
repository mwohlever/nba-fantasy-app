export type AdminMenuLink = {
  href: string;
  label: string;
};

export type AdminMenuGroup = {
  label: string;
  links: AdminMenuLink[];
};


function getCommissionerLinks(
  sport: string,
): AdminMenuLink[] {
  const links: AdminMenuLink[] = [
    {
      href: "/admin",
      label: "Overview",
    },

    {
      href:
        "/admin/groups?view=commissioner",

      label:
        "Group Settings",
    },
  ];


  /*
   * NBA Skins intentionally has a minimal commissioner surface.
   */
  if (
    sport === "nba-skins"
  ) {
    return links;
  }


  /*
   * NCAA Pick 'Em has no draft/slate administration.
   */
  if (
    sport === "ncaa"
  ) {
    return [
      ...links,

      {
        href: "/admin/ncaa-pickem",
        label: "NCAA Pick 'Em",
      },

      {
        href: "/admin/notification-templates",
        label: "Notification Control",
      },

      {
        href: "/admin/notification-history",
        label: "Notification History",
      },
    ];
  }


  /*
   * NBA / NFL / Golf slate operations.
   */
  links.push(
    {
      href: "/slates/new",
      label: "Create Slate",
    },

    {
      href: "/admin/slates",
      label: "Manage Slates",
    },
  );


  if (
    sport === "nba"
  ) {
    links.push({
      href: "/admin/slate-games",
      label: "Slate NBA Games",
    });
  }


  links.push(
    {
      href: "/admin/corrections",
      label: "Corrections",
    },

    {
      href: "/admin/notification-templates",
      label: "Notification Control",
    },

    {
      href: "/admin/notification-history",
      label: "Notification History",
    },
  );


  if (
    sport === "nba"
  ) {
    links.push({
      href: "/admin/players",
      label: "Manage NBA Players",
    });
  }


  if (
    sport === "nfl"
  ) {
    links.push({
      href: "/admin/players-nfl",
      label: "Manage NFL Players",
    });
  }


  links.push({
    href: "/admin/league-awards",
    label: "League Awards",
  });


  return links;
}


export function getAdminMenuGroups(
  sport: string,
  isSuperAdmin = false,
): AdminMenuGroup[] {
  const groups: AdminMenuGroup[] = [];


  if (
    isSuperAdmin
  ) {
    groups.push({
      label: "Super Admin",

      links: [
        {
          href: "/admin/platform",
          label: "Super Admin Center",
        },
      ],
    });
  }


  groups.push({
    label: "Commissioner Center",

    links:
      getCommissionerLinks(
        sport,
      ),
  });


  return groups;
}
