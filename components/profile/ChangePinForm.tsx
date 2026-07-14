"use client";

import { useState } from "react";

type PinFieldProps = {
  id: string;
  label: string;
  value: string;
  show: boolean;
  autoComplete: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onToggleShow: () => void;
};

function PinField({
  id,
  label,
  value,
  show,
  autoComplete,
  disabled,
  onChange,
  onToggleShow,
}: PinFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-sm font-semibold text-slate-800"
      >
        {label}
      </label>

      <div className="relative mt-2">
        <input
          id={id}
          type={show ? "text" : "password"}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          maxLength={8}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, 8))
          }
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-20 text-base tracking-[0.25em] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
        />

        <button
          type="button"
          onClick={onToggleShow}
          disabled={disabled}
          className="absolute inset-y-0 right-0 px-4 text-xs font-semibold text-sky-700 transition hover:text-sky-900 disabled:opacity-50"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export default function ChangePinForm() {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] =
    useState<"success" | "warning" | "error" | null>(null);

  const formIsValid =
    /^\d{4,8}$/.test(currentPin) &&
    /^\d{4,8}$/.test(newPin) &&
    /^\d{4,8}$/.test(confirmPin) &&
    newPin === confirmPin &&
    newPin !== currentPin;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setIsSaving(true);
      setMessage("");
      setMessageType(null);

      const response = await fetch("/api/account/change-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPin,
          newPin,
          confirmPin,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Unable to update your PIN.");
        setMessageType("error");
        return;
      }

      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");

      setShowCurrentPin(false);
      setShowNewPin(false);
      setShowConfirmPin(false);

      if (result.warning) {
        setMessage(result.warning);
        setMessageType("warning");
      } else {
        setMessage(
          result.message ||
            "PIN updated successfully. Other devices were logged out."
        );
        setMessageType("success");
      }
    } catch (error) {
      console.error("Failed to change PIN", error);
      setMessage("Something went wrong while updating your PIN.");
      setMessageType("error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Change PIN
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          Updating your PIN keeps this device signed in and logs out every
          other signed-in device.
        </p>
      </div>

      {message ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            messageType === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : messageType === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="mt-5 grid gap-4 lg:grid-cols-3"
      >
        <PinField
          id="current-pin"
          label="Current PIN"
          value={currentPin}
          show={showCurrentPin}
          autoComplete="current-password"
          disabled={isSaving}
          onChange={setCurrentPin}
          onToggleShow={() => setShowCurrentPin((current) => !current)}
        />

        <PinField
          id="new-pin"
          label="New PIN"
          value={newPin}
          show={showNewPin}
          autoComplete="new-password"
          disabled={isSaving}
          onChange={setNewPin}
          onToggleShow={() => setShowNewPin((current) => !current)}
        />

        <PinField
          id="confirm-pin"
          label="Confirm New PIN"
          value={confirmPin}
          show={showConfirmPin}
          autoComplete="new-password"
          disabled={isSaving}
          onChange={setConfirmPin}
          onToggleShow={() => setShowConfirmPin((current) => !current)}
        />

        <div className="lg:col-span-3">
          {newPin && confirmPin && newPin !== confirmPin ? (
            <p className="mb-3 text-sm text-red-600">
              The new PINs do not match.
            </p>
          ) : null}

          {newPin && currentPin && newPin === currentPin ? (
            <p className="mb-3 text-sm text-red-600">
              Your new PIN must differ from your current PIN.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSaving || !formIsValid}
            className="w-full rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            {isSaving ? "Updating PIN…" : "Update PIN"}
          </button>
        </div>
      </form>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        Your PIN must contain 4–8 numbers. Avoid birthdays, repeated digits,
        or other combinations that are easy to guess.
      </div>
    </section>
  );
}
