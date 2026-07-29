"use client";

import { useEffect, useState } from "react";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { getSportConfig } from "@/lib/sports";

export default function DynamicFavicon() {
  const { selectedSport, isHydrated } = useSelectedSport();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

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

    setDataUrl(canvas.toDataURL("image/png"));
  }, [selectedSport, isHydrated]);

  if (!dataUrl) return null;

  return <link rel="icon" type="image/png" href={dataUrl} />;
}
