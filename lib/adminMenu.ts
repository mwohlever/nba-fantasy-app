export type AdminMenuLink = {
  href: string;
  label: string;
};

export type AdminMenuGroup = {
  label: string;
  links: AdminMenuLink[];
};


function getCommissionerLinks(): AdminMenuLink[] {
  return [
    {
      href: "/admin",
      label: "Commissioner Center",
    },

    {
      href:
        "/admin/groups?view=commissioner",

      label:
        "Group Settings",
    },
  ];
}


export function getAdminMenuGroups(
  _sport: string,
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
    label: "Commissioner",

    links:
      getCommissionerLinks(),
  });


  return groups;
}
