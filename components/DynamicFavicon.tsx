"use client";

import { useEffect } from "react";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { getSportConfig } from "@/lib/sports";

export default function DynamicFavicon() {
  const { selectedSport, isHydrated } = useSelectedSport();

  useEffect(() => {
    if (!isHydrated) return;

    const emoji = getSportConfig(selectedSport).emoji;

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, 64, 64);
    ctx.font = "56px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, 32, 36);

    const dataUrl = canvas.toDataURL("image/png");

    document
      .querySelectorAll<HTMLLinkElement>("link[rel~='icon']")
      .forEach((el) => el.parentNode?.removeChild(el));

    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href = dataUrl;
    document.head.appendChild(link);
  }, [selectedSport, isHydrated]);

  return null;
}
