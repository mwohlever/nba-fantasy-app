"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const themeOptions = [
  {
    id: "system",
    label: "System",
    icon: "💻",
    description: "Match this device’s light or dark appearance.",
  },
  {
    id: "light",
    label: "Light",
    icon: "☀️",
    description: "Always use the light color scheme.",
  },
  {
    id: "dark",
    label: "Dark",
    icon: "🌙",
    description: "Always use the dark color scheme.",
  },
] as const;

export default function ThemeSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-slate-500">
          Loading appearance settings...
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Appearance
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          Choose how 111 Fantasy Sports looks on this device.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {themeOptions.map((option) => {
          const isSelected = theme === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              className={`rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100"
                  : "border-slate-200 bg-slate-50 hover:border-sky-300 hover:bg-sky-50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-2xl">{option.icon}</span>

                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                    isSelected
                      ? "border-sky-600 bg-sky-600 text-white"
                      : "border-slate-300 bg-white text-transparent"
                  }`}
                >
                  ✓
                </span>
              </div>

              <div className="mt-3 font-bold text-slate-900">
                {option.label}
              </div>

              <div className="mt-1 text-xs leading-5 text-slate-500">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Current appearance:{" "}
        <span className="font-semibold capitalize text-slate-900">
          {theme === "system"
            ? `System (${resolvedTheme ?? "detecting"})`
            : theme}
        </span>
      </div>
    </section>
  );
}
