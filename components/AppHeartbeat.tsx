"use client";

import {
  useEffect,
  useRef,
} from "react";

const HEARTBEAT_INTERVAL_MS =
  5 *
  60 *
  1000;

export default function AppHeartbeat() {
  const runningRef =
    useRef(false);

  const lastRunRef =
    useRef(0);

  useEffect(() => {
    async function runHeartbeat(
      force = false,
    ) {
      const now =
        Date.now();

      if (
        runningRef.current
      ) {
        return;
      }

      /*
       * Prevent mount/focus/visibility events from causing
       * multiple requests within a few seconds.
       */
      if (
        !force &&
        now -
          lastRunRef.current <
          60_000
      ) {
        return;
      }

      runningRef.current =
        true;

      lastRunRef.current =
        now;

      try {
        await fetch(
          "/api/app-heartbeat",
          {
            method: "POST",
            cache: "no-store",
          },
        );
      } catch (error) {
        /*
         * Maintenance should never interrupt normal app use.
         */
        console.error(
          "111 Sports app heartbeat failed",
          error,
        );
      } finally {
        runningRef.current =
          false;
      }
    }

    void runHeartbeat(
      true,
    );

    const interval =
      window.setInterval(
        () => {
          if (
            document.visibilityState ===
            "visible"
          ) {
            void runHeartbeat();
          }
        },
        HEARTBEAT_INTERVAL_MS,
      );

    function handleVisibility() {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void runHeartbeat();
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.clearInterval(
        interval,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, []);

  return null;
}
