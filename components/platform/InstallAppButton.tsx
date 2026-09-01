"use client";

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const detectionTimer = window.setTimeout(() => {
      setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
      setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));
    }, 0);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handlePrompt);
    return () => {
      window.clearTimeout(detectionTimer);
      window.removeEventListener("beforeinstallprompt", handlePrompt);
    };
  }, []);

  return (
    <div className="text-sm">
      <button
        type="button"
        disabled={isStandalone}
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            await prompt.userChoice;
            setPrompt(null);
          } else if (isIos) {
            setShowIosHelp((shown) => !shown);
          } else {
            setShowIosHelp((shown) => !shown);
          }
        }}
        className="inline-flex h-10 items-center justify-center rounded-full border border-teal-300/50 bg-transparent px-5 text-sm font-bold text-teal-100 transition hover:bg-teal-300/10 disabled:border-slate-700 disabled:text-slate-400"
      >
        {isStandalone ? "111 Sports Installed" : "Install 111 Sports"}
      </button>
      {showIosHelp ? (
        <p className="mt-2 max-w-xs text-xs leading-5 text-slate-300">
          {isIos
            ? "In Safari, tap Share, then Add to Home Screen."
            : "Open your browser menu and choose Install app or Add to Home Screen."}
        </p>
      ) : null}
    </div>
  );
}
