"use client";
import { useEffect, useState } from "react";

/** Keyed state and cancellation prevent old player/season/Group data from flashing into a new profile. */
export function useCenterResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, error: "" });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, data: null, error: error instanceof Error ? error.message : "Statistics unavailable." });
    });
    return () => controller.abort();
  }, [key, load]);
  return state.key === key ? { ...state, loading: false } : { key, data: null, error: "", loading: true };
}
