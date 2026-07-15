"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function DarkModeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && theme === "dark";

  function toggleDarkMode() {
    const nextTheme = isDark ? "light" : "dark";

    /*
     * next-themes should handle this automatically. Updating the root class
     * directly as well guarantees the existing global .dark styles activate
     * immediately.
     */
    document.documentElement.classList.toggle(
      "dark",
      nextTheme === "dark"
    );

    document.documentElement.style.colorScheme = nextTheme;

    setTheme(nextTheme);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      disabled={!mounted}
      onClick={toggleDarkMode}
      className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-100 disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true">
          {isDark ? "🌙" : "☀️"}
        </span>

        <span className="text-sm font-medium text-slate-700">
          Dark Mode
        </span>
      </span>

      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          isDark ? "bg-sky-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${
            isDark ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}
