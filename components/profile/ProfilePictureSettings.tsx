"use client";

import { ChangeEvent, useEffect, useState } from "react";

type Props = {
  displayName: string;
  avatarUrl: string | null;
  fallbackUrl: string | null;
  onAvatarChanged: (avatarUrl: string | null) => void;
};

type RecentAvatar = {
  id: string;
  url: string;
  createdAt: string;
  isActive: boolean;
};

export default function ProfilePictureSettings({
  displayName,
  avatarUrl,
  fallbackUrl,
  onAvatarChanged,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recentAvatars, setRecentAvatars] = useState<RecentAvatar[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] =
    useState<"success" | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRecentAvatars() {
      try {
        const response = await fetch("/api/account/profile-picture", {
          cache: "no-store",
        });
        const result = await response.json();
        if (!cancelled && response.ok) setRecentAvatars(result.avatars ?? []);
      } catch (error) {
        console.error("Failed to load recent profile pictures", error);
      } finally {
        if (!cancelled) setIsLoadingRecent(false);
      }
    }

    void loadRecentAvatars();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function applyAvatarResult(result: {
    avatarUrl?: string | null;
    avatars?: RecentAvatar[];
  }) {
    onAvatarChanged(result.avatarUrl ?? null);
    setRecentAvatars(result.avatars ?? []);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    setMessage("");
    setMessageType(null);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPG, PNG, or WebP image.");
      setMessageType("error");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage("The image must be 5 MB or smaller.");
      setMessageType("error");
      event.target.value = "";
      return;
    }

    if (previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function uploadPicture() {
    if (!selectedFile) return;

    try {
      setIsSaving(true);
      setMessage("");
      setMessageType(null);

      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/account/profile-picture", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Unable to upload your profile picture.");
        setMessageType("error");
        return;
      }

      applyAvatarResult(result);
      setSelectedFile(null);

      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(null);
      setMessage("Profile picture updated.");
      setMessageType("success");
    } catch (error) {
      console.error("Failed to upload profile picture", error);
      setMessage("Unable to upload your profile picture.");
      setMessageType("error");
    } finally {
      setIsSaving(false);
    }
  }

  async function removePicture() {
    try {
      setIsSaving(true);
      setMessage("");
      setMessageType(null);

      const response = await fetch("/api/account/profile-picture", {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Unable to remove your profile picture.");
        setMessageType("error");
        return;
      }

      applyAvatarResult(result);
      setSelectedFile(null);

      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(null);
      setMessage("Custom profile picture removed.");
      setMessageType("success");
    } catch (error) {
      console.error("Failed to remove profile picture", error);
      setMessage("Unable to remove your profile picture.");
      setMessageType("error");
    } finally {
      setIsSaving(false);
    }
  }

  async function selectRecentAvatar(avatarImageId: string) {
    try {
      setIsSaving(true);
      setMessage("");
      setMessageType(null);

      const response = await fetch("/api/account/profile-picture", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarImageId }),
      });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Unable to select your profile picture.");
        setMessageType("error");
        return;
      }

      applyAvatarResult(result);
      setSelectedFile(null);
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setMessage("Profile picture updated.");
      setMessageType("success");
    } catch (error) {
      console.error("Failed to select profile picture", error);
      setMessage("Unable to select your profile picture.");
      setMessageType("error");
    } finally {
      setIsSaving(false);
    }
  }

  const imageSrc = previewUrl || avatarUrl || fallbackUrl;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Profile Picture
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-600">
          Upload a square photo for your league profile. Your current league
          headshot remains the fallback.
        </p>
      </div>

      {message ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            messageType === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={`${displayName} profile preview`}
            className="h-32 w-32 rounded-3xl border border-slate-200 object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-3xl border border-slate-200 bg-slate-100 text-4xl font-bold text-slate-500">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="flex-1 space-y-3">
          <label className="block">
            <span className="sr-only">Choose profile picture</span>

            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={isSaving}
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-sky-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-sky-800 hover:file:bg-sky-200 disabled:opacity-50"
            />
          </label>

          <p className="text-xs leading-5 text-slate-500">
            JPG, PNG, or WebP. Maximum file size: 5 MB.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void uploadPicture()}
              disabled={isSaving || !selectedFile}
              className="rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSaving ? "Saving…" : "Save Picture"}
            </button>

            {avatarUrl ? (
              <button
                type="button"
                onClick={() => void removePicture()}
                disabled={isSaving}
                className="rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Remove Custom Picture
              </button>
            ) : null}

            {selectedFile ? (
              <button
                type="button"
                onClick={() => {
                  if (previewUrl?.startsWith("blob:")) {
                    URL.revokeObjectURL(previewUrl);
                  }

                  setSelectedFile(null);
                  setPreviewUrl(null);
                  setMessage("");
                  setMessageType(null);
                }}
                disabled={isSaving}
                className="rounded-xl px-5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {isLoadingRecent || recentAvatars.length > 0 ? (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">Recent pictures</h3>
            <span className="text-xs text-slate-500">Up to 5 uploads</span>
          </div>

          {isLoadingRecent ? (
            <p className="mt-3 text-sm text-slate-500">Loading recent pictures…</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-3">
              {recentAvatars.map((avatar, index) => (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => void selectRecentAvatar(avatar.id)}
                  disabled={isSaving || avatar.isActive}
                  aria-label={`Use recent profile picture ${index + 1}`}
                  aria-pressed={avatar.isActive}
                  className={`relative h-16 w-16 overflow-hidden rounded-2xl border-2 transition focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-default ${
                    avatar.isActive
                      ? "border-sky-500 ring-2 ring-sky-100"
                      : "border-slate-200 hover:border-sky-300"
                  }`}
                >
                  <img src={avatar.url} alt="" className="h-full w-full object-cover" />
                  {avatar.isActive ? (
                    <span className="absolute inset-x-0 bottom-0 bg-sky-700/90 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                      Current
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
