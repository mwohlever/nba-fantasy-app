"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  useParams,
  useRouter,
} from "next/navigation";

import {
  getSupabaseBrowserClient,
} from "@/lib/supabaseBrowser";


type InviteResponse = {
  success?: boolean;

  error?: string;

  invite?: {
    id: string;
    email: string;
    expiresAt: string;
    createdAt: string;
  };

  group?: {
    id: string;
    name: string;
    slug: string;
  };
};


type Mode =
  | "signin"
  | "signup";


export default function GroupInvitePage() {
  const router =
    useRouter();


  const params =
    useParams<{
      token:
        string;
    }>();


  const token =
    String(
      params.token ??
        "",
    );


  const [
    inviteData,
    setInviteData,
  ] =
    useState<InviteResponse | null>(
      null,
    );


  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );


  const [
    submitting,
    setSubmitting,
  ] =
    useState(
      false,
    );


  const [
    message,
    setMessage,
  ] =
    useState(
      "",
    );


  const [
    mode,
    setMode,
  ] =
    useState<Mode>(
      "signup",
    );


  const [
    displayName,
    setDisplayName,
  ] =
    useState(
      "",
    );


  const [
    password,
    setPassword,
  ] =
    useState(
      "",
    );


  const [
    confirmPassword,
    setConfirmPassword,
  ] =
    useState(
      "",
    );


  const [
    showPassword,
    setShowPassword,
  ] =
    useState(
      false,
    );


  useEffect(
    () => {
      let cancelled =
        false;


      async function loadInvite() {
        try {
          const response =
            await fetch(
              `/api/group-invites/${encodeURIComponent(
                token,
              )}`,
              {
                cache:
                  "no-store",
              },
            );


          const result =
            (
              await response.json()
            ) as InviteResponse;


          if (
            !response.ok
          ) {
            throw new Error(
              result.error ??
                "This invitation is unavailable.",
            );
          }


          if (
            !cancelled
          ) {
            setInviteData(
              result,
            );
          }
        } catch (
          error
        ) {
          if (
            !cancelled
          ) {
            setMessage(
              error instanceof
              Error
                ? error.message
                : "Unable to load invitation.",
            );
          }
        } finally {
          if (
            !cancelled
          ) {
            setLoading(
              false,
            );
          }
        }
      }


      if (token) {
        void loadInvite();
      } else {
        setLoading(
          false,
        );

        setMessage(
          "Invitation token is missing.",
        );
      }


      return () => {
        cancelled =
          true;
      };
    },
    [
      token,
    ],
  );


  async function acceptAuthenticatedInvite(
    accessToken:
      string,

    requestedDisplayName?:
      string,
  ) {
    const response =
      await fetch(
        `/api/group-invites/${encodeURIComponent(
          token,
        )}`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              accessToken,

              displayName:
                requestedDisplayName ??
                "",
            }),
        },
      );


    const result =
      await response
        .json();


    if (
      !response.ok
    ) {
      throw new Error(
        result.error ??
          "Unable to accept invitation.",
      );
    }

    const invitedGroupSlug =
      String(result?.group?.slug ?? inviteData?.group?.slug ?? "").trim();


    /*
     * Invitation is now consumed and the account exists.
     * Let the existing bridge create the normal 111 Sports
     * HttpOnly application session.
     */
    const bridgeResponse =
      await fetch(
        "/api/auth/bridge",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              accessToken,
            }),
        },
      );


    const bridgeResult =
      await bridgeResponse
        .json();


    if (
      !bridgeResponse.ok
    ) {
      throw new Error(
        bridgeResult.error ??
          "Your Group was joined, but sign-in could not be completed.",
      );
    }

    if (invitedGroupSlug) {
      const activeGroupResponse = await fetch("/api/groups/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupSlug: invitedGroupSlug }),
      });
      if (!activeGroupResponse.ok) {
        throw new Error("Your Group was joined, but it could not be opened.");
      }
    }


    const supabase =
      getSupabaseBrowserClient();


    await supabase
      .auth
      .signOut();


    router.replace(
      invitedGroupSlug
        ? `/groups/${encodeURIComponent(invitedGroupSlug)}`
        : "/",
    );

    router.refresh();
  }


  async function handleGoogle() {
    try {
      setSubmitting(
        true,
      );

      setMessage(
        "",
      );


      const supabase =
        getSupabaseBrowserClient();


      const redirectTo =
        `${window.location.origin}/auth/callback?invite=${encodeURIComponent(
          token,
        )}`;


      const {
        error,
      } =
        await supabase
          .auth
          .signInWithOAuth({
            provider:
              "google",

            options: {
              redirectTo,
            },
          });


      if (error) {
        throw error;
      }
    } catch (
      error
    ) {
      console.error(
        error,
      );


      setMessage(
        error instanceof
        Error
          ? error.message
          : "Google sign in failed.",
      );


      setSubmitting(
        false,
      );
    }
  }


  async function handleEmail(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();


    const inviteEmail =
      inviteData?.invite
        ?.email ??
      "";


    if (
      !inviteEmail
    ) {
      return;
    }


    try {
      setSubmitting(
        true,
      );

      setMessage(
        "",
      );


      const supabase =
        getSupabaseBrowserClient();


      if (
        mode ===
        "signup"
      ) {
        const cleanName =
          displayName
            .trim();


        if (
          !cleanName
        ) {
          setMessage(
            "Enter the name you want to use in 111 Sports.",
          );

          return;
        }


        if (
          password.length <
          8
        ) {
          setMessage(
            "Use a password with at least 8 characters.",
          );

          return;
        }


        if (
          password !==
          confirmPassword
        ) {
          setMessage(
            "The passwords do not match.",
          );

          return;
        }


        const {
          data,
          error,
        } =
          await supabase
            .auth
            .signUp({
              email:
                inviteEmail,

              password,

              options: {
                data: {
                  display_name:
                    cleanName,
                },

                emailRedirectTo:
                  `${window.location.origin}/auth/callback?invite=${encodeURIComponent(
                    token,
                  )}`,
              },
            });


        if (error) {
          throw error;
        }


        if (
          data.session
        ) {
          await acceptAuthenticatedInvite(
            data.session
              .access_token,

            cleanName,
          );

          return;
        }


        /*
         * Supabase email-confirmation is enabled.
         * The confirmation link returns through auth/callback,
         * which will finish this same invitation.
         */
        setMessage(
          `Check ${inviteEmail} for the confirmation email. After you confirm it, 111 Sports will finish joining ${inviteData?.group?.name ?? "the Group"}.`,
        );

        return;
      }


      const {
        data,
        error,
      } =
        await supabase
          .auth
          .signInWithPassword({
            email:
              inviteEmail,

            password,
          });


      if (error) {
        throw error;
      }


      if (
        !data.session
      ) {
        throw new Error(
          "No authentication session was returned.",
        );
      }


      await acceptAuthenticatedInvite(
        data.session
          .access_token,
      );
    } catch (
      error
    ) {
      console.error(
        error,
      );


      setMessage(
        error instanceof
        Error
          ? error.message
          : "Unable to continue.",
      );
    } finally {
      setSubmitting(
        false,
      );
    }
  }


  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-white">
        <section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center shadow-xl">
          <div className="text-4xl">
            🏆
          </div>

          <h1 className="mt-4 text-2xl font-bold">
            111 Sports
          </h1>

          <p className="mt-3 text-sm text-slate-300">
            Checking your invitation…
          </p>
        </section>
      </main>
    );
  }


  if (
    !inviteData?.invite ||
    !inviteData?.group
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-white">
        <section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center shadow-xl">
          <div className="text-4xl">
            🏆
          </div>

          <h1 className="mt-4 text-2xl font-bold">
            111 Sports
          </h1>

          <div className="mt-5 rounded-2xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-100">
            {message ||
              "This invitation is unavailable."}
          </div>
        </section>
      </main>
    );
  }


  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <div className="text-center">
          <div className="text-4xl">
            🏆
          </div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Join {inviteData.group.name}
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            You've been invited to join this Group on 111 Sports.
          </p>
        </div>


        <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
            Invitation
          </div>

          <div className="mt-2 text-sm">
            <span className="text-slate-400">
              Email:
            </span>{" "}
            <span className="font-semibold">
              {inviteData.invite.email}
            </span>
          </div>

          <div className="mt-1 text-xs text-slate-500">
            You must authenticate with this exact email address.
          </div>
        </div>


        {message ? (
          <div className="mt-5 rounded-2xl border border-sky-800 bg-sky-950/60 px-4 py-3 text-sm leading-6 text-sky-100">
            {message}
          </div>
        ) : null}


        <button
          type="button"
          onClick={
            handleGoogle
          }
          disabled={
            submitting
          }
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-600 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <span className="text-lg">
            G
          </span>

          Continue with Google
        </button>


        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-700" />

          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            or
          </span>

          <div className="h-px flex-1 bg-slate-700" />
        </div>


        <div className="grid grid-cols-2 rounded-xl border border-slate-700 bg-slate-950 p-1">
          <button
            type="button"
            onClick={() =>
              setMode(
                "signup",
              )
            }
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              mode ===
              "signup"
                ? "bg-sky-600 text-white"
                : "text-slate-400"
            }`}
          >
            New account
          </button>

          <button
            type="button"
            onClick={() =>
              setMode(
                "signin",
              )
            }
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              mode ===
              "signin"
                ? "bg-sky-600 text-white"
                : "text-slate-400"
            }`}
          >
            Existing account
          </button>
        </div>


        <form
          onSubmit={
            handleEmail
          }
          className="mt-5 space-y-4"
        >
          {mode ===
          "signup" ? (
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-300">
                Display name
              </label>

              <input
                value={
                  displayName
                }
                onChange={(
                  event,
                ) =>
                  setDisplayName(
                    event.target
                      .value,
                  )
                }
                autoComplete="name"
                placeholder="Your name"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-sky-500"
              />
            </div>
          ) : null}


          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Email
            </label>

            <input
              value={
                inviteData
                  .invite
                  .email
              }
              disabled
              className="w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-slate-400"
            />
          </div>


          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Password
            </label>

            <div className="relative">
              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={
                  password
                }
                onChange={(
                  event,
                ) =>
                  setPassword(
                    event.target
                      .value,
                  )
                }
                autoComplete={
                  mode ===
                  "signup"
                    ? "new-password"
                    : "current-password"
                }
                placeholder="Password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 pr-20 outline-none focus:border-sky-500"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    (
                      current,
                    ) =>
                      !current,
                  )
                }
                className="absolute inset-y-0 right-0 px-4 text-xs font-semibold text-sky-400"
              >
                {showPassword
                  ? "Hide"
                  : "Show"}
              </button>
            </div>
          </div>


          {mode ===
          "signup" ? (
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-300">
                Confirm password
              </label>

              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={
                  confirmPassword
                }
                onChange={(
                  event,
                ) =>
                  setConfirmPassword(
                    event.target
                      .value,
                  )
                }
                autoComplete="new-password"
                placeholder="Confirm password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-sky-500"
              />
            </div>
          ) : null}


          <button
            type="submit"
            disabled={
              submitting ||
              !password ||
              (
                mode ===
                  "signup" &&
                !displayName
                  .trim()
              )
            }
            className="w-full rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {submitting
              ? "Working…"
              : mode ===
                  "signup"
                ? "Create account & join"
                : "Sign in & join"}
          </button>
        </form>


        <p className="mt-5 text-center text-xs leading-5 text-slate-500">
          This invitation only grants membership to{" "}
          {inviteData.group.name}. Your 111 Sports account can belong to multiple Groups.
        </p>
      </section>
    </main>
  );
}
