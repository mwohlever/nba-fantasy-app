"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_SPORT } from "@/lib/sports";

const SPORT_STORAGE_KEY = "111-fantasy-sport";

type SportContextValue = {
  selectedSport: string;
  setSelectedSport: (sport: string) => void;
};

const SportContext = createContext<SportContextValue | undefined>(undefined);

export default function SportProvider({ children }: { children: React.ReactNode }) {
  const [selectedSport, setSelectedSportState] = useState<string>(DEFAULT_SPORT);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SPORT_STORAGE_KEY);
      if (stored) {
        setSelectedSportState(stored);
      }
    } catch (error) {
      console.error("Failed to read stored sport", error);
    }
  }, []);

  function setSelectedSport(sport: string) {
    setSelectedSportState(sport);
    try {
      window.localStorage.setItem(SPORT_STORAGE_KEY, sport);
    } catch (error) {
      console.error("Failed to persist selected sport", error);
    }
  }

  return (
    <SportContext.Provider value={{ selectedSport, setSelectedSport }}>
      {children}
    </SportContext.Provider>
  );
}

export function useSelectedSport() {
  const context = useContext(SportContext);

  if (!context) {
    throw new Error("useSelectedSport must be used within a SportProvider");
  }

  return context;
}
