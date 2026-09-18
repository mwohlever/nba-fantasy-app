"use client";

import { FormEvent, useEffect, useState } from "react";

type DisplayNameSettingsProps = {
  displayName: string;
  onDisplayNameChanged: (displayName: string) => void;
};

export default function DisplayNameSettings({
  displayName,
  onDisplayNameChanged,
}: DisplayNameSettingsProps) {
  const [value, setValue] = useState(displayName);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    setValue(displayName);
  }, [displayName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextDisplayName = value.trim().replace(/\s+/g, " ");

    if (!nextDisplayName) {
      setIsError(true);
      setMessage("Enter a display name.");
      return;
    }

    if (nextDisplayName.length > 40) {
      setIsError(true);
      setMessage("Display name must be 40 characters or fewer.");
      return;
    }

    try {
      setIsSaving(true);
      setIsError(false);
      setMessage("");

      const response = await fetch("/api/account/display-name", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: nextDisplayName,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setIsError(true);
        setMessage(
          result.error || "Unable to update your display name.",
        );
        return;
      }

      const savedDisplayName = String(
        result.displayName ?? nextDisplayName,
      );

      setValue(savedDisplayName);
      onDisplayNameChanged(savedDisplayName);
      setMessage("Display name updated.");
    } catch (error) {
      console.error("Failed to update display name", error);
      setIsError(true);
      setMessage("Unable to update your display name.");
    } finally {
      setIsSaving(false);
    }
  }

  const normalizedValue = value.trim().replace(/\s+/g, " ");
  const hasChanges = normalizedValue !== displayName;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Display Name
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          This is the name other players will see throughout 111 Sports.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5">
        <label
          htmlFor="display-name"
          className="text-sm font-semibold text-slate-700"
        >
          Name
        </label>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            id="display-name"
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setMessage("");
              setIsError(false);
            }}
            maxLength={40}
            autoComplete="name"
            disabled={isSaving}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
          />

          <button
            type="submit"
            disabled={
              isSaving ||
              !normalizedValue ||
              normalizedValue.length > 40 ||
              !hasChanges
            }
            className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSaving ? "Saving..." : "Save Name"}
          </button>
        </div>

        {message ? (
          <p
            className={`mt-3 text-sm ${
              isError ? "text-red-700" : "text-emerald-700"
            }`}
          >
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
