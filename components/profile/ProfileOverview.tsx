"use client";

import type {
  ComponentProps,
} from "react";

import {
  useSelectedSport,
} from "@/components/providers/SportProvider";

import NbaProfileOverview from "@/components/profile/NbaProfileOverview";
import NflProfileOverview from "@/components/profile/NflProfileOverview";


type Props =
  ComponentProps<
    typeof NbaProfileOverview
  >;


export default function ProfileOverview(
  props: Props,
) {
  const {
    selectedSport,
  } =
    useSelectedSport();

  if (
    selectedSport ===
    "nfl"
  ) {
    return (
      <NflProfileOverview
        {...props}
      />
    );
  }

  return (
    <NbaProfileOverview
      {...props}
    />
  );
}
