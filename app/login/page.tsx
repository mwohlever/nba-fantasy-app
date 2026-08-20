"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  getSupabaseBrowserClient,
} from "@/lib/supabaseBrowser";


type Team = {
  id: number;
  name: string;
};


const PENDING_AUTH_TOKEN_KEY =
  "111_pending_auth_access_token";


export default function LoginPage() {
  const router =
    useRouter();


  const [
    teams,
    setTeams,
  ] =
    useState<Team[]>(
      [],
    );

  const [
    selectedTeamId,
    setSelectedTeamId,
  ] =
    useState(
      "",
    );

  const [
    pin,
    setPin,
  ] =
    useState(
      "",
    );

  const [
    showPin,
    setShowPin,
  ] =
    useState(
      false,
    );

  const [
    email,
    setEmail,
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
    showPassword,
    setShowPassword,
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
    isLoadingTeams,
    setIsLoadingTeams,
  ] =
    useState(
      true,
    );

  const [
    isSubmitting,
    setIsSubmitting,
  ] =
    useState(
      false,
    );

  const [
    pendingAccessToken,
    setPendingAccessToken,
  ] =
    useState<
      string | null
    >(
      null,
    );

  const [
    showLegacyLogin,
    setShowLegacyLogin,
  ] =
    useState(
      false,
    );


  useEffect(
    () => {
      async function loadTeams() {
        try {
          const response =
            await fetch(
              "/api/teams",
              {
                cache:
                  "no-store",
              },
            );


          const result =
            await response
              .json();


          if (
            !response.ok
          ) {
            setMessage(
              result.error ||
                "Failed to load existing 111 members.",
            );

            return;
          }


          const safeTeams =
            (
              result.teams ??
              []
            ) as Team[];


          setTeams(
            safeTeams,
          );


          if (
            safeTeams.length >
            0
          ) {
            setSelectedTeamId(
              String(
                safeTeams[0]
                  .id,
              ),
            );
          }
        } catch (
          error
        ) {
          console.error(
            error,
          );

          setMessage(
            "Failed to load existing 111 members.",
          );
        } finally {
          setIsLoadingTeams(
            false,
          );
        }
      }


      void loadTeams();


      const pending =
        sessionStorage.getItem(
          PENDING_AUTH_TOKEN_KEY,
        );


      if (
        pending
      ) {
        setPendingAccessToken(
          pending,
        );

        setShowLegacyLogin(
          true,
        );

        setMessage(
          "Your modern sign-in worked. Link it to your existing 111 Sports account one time using your current PIN.",
        );
      }
    },
    [],
  );


  async function finishModernSession(
    accessToken:
      string,
  ) {
    sessionStorage.setItem(
      PENDING_AUTH_TOKEN_KEY,
      accessToken,
    );


    const response =
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
            JSON.stringify(
              {
                accessToken,
              },
            ),
        },
      );


    const result =
      await response
        .json();


    if (
      response.ok
    ) {
      sessionStorage.removeItem(
        PENDING_AUTH_TOKEN_KEY,
      );


      const supabase =
        getSupabaseBrowserClient();


      await supabase
        .auth
        .signOut();


      router.push(
        "/",
      );

      router.refresh();

      return true;
    }


    if (
      response.status ===
        409 &&
      result.code ===
        "ACCOUNT_LINK_REQUIRED"
    ) {
      setPendingAccessToken(
        accessToken,
      );

      setShowLegacyLogin(
        true,
      );

      setMessage(
        "That email is authenticated, but it is not linked to a 111 Sports account yet. Existing member? Link it below with your current PIN.",
      );

      return false;
    }


    sessionStorage.removeItem(
      PENDING_AUTH_TOKEN_KEY,
    );


    throw new Error(
      result.error ||
        "Unable to complete sign in.",
    );
  }


  async function handleGoogleSignIn() {
    try {
      setIsSubmitting(
        true,
      );

      setMessage(
        "",
      );


      const supabase =
        getSupabaseBrowserClient();


      const redirectTo =
        `${window.location.origin}/auth/callback`;


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


      if (
        error
      ) {
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

      setIsSubmitting(
        false,
      );
    }
  }


  async function handleEmailLogin(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();


    try {
      setIsSubmitting(
        true,
      );

      setMessage(
        "",
      );


      const normalizedEmail =
        email
          .trim()
          .toLowerCase();


      if (
        !normalizedEmail ||
        !password
      ) {
        setMessage(
          "Enter your email and password.",
        );

        return;
      }


      const supabase =
        getSupabaseBrowserClient();


      const {
        data,
        error,
      } =
        await supabase
          .auth
          .signInWithPassword({
            email:
              normalizedEmail,

            password,
          });


      if (
        error
      ) {
        throw error;
      }


      if (
        !data.session
      ) {
        throw new Error(
          "No authentication session was returned.",
        );
      }


      await finishModernSession(
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
          : "Email sign in failed.",
      );
    } finally {
      setIsSubmitting(
        false,
      );
    }
  }


  async function handleLegacySubmit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();


    try {
      setIsSubmitting(
        true,
      );

      setMessage(
        "",
      );


      /*
       * If Supabase already authenticated an email, this is a
       * ONE-TIME ACCOUNT LINK rather than a normal PIN login.
       */
      if (
        pendingAccessToken
      ) {
        const response =
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
                JSON.stringify(
                  {
                    accessToken:
                      pendingAccessToken,

                    legacyTeamId:
                      Number(
                        selectedTeamId,
                      ),

                    legacyPin:
                      pin,
                  },
                ),
            },
          );


        const result =
          await response
            .json();


        if (
          !response.ok
        ) {
          setMessage(
            result.error ||
              "Unable to link your existing account.",
          );

          return;
        }


        sessionStorage.removeItem(
          PENDING_AUTH_TOKEN_KEY,
        );


        const supabase =
          getSupabaseBrowserClient();


        await supabase
          .auth
          .signOut();


        router.push(
          "/",
        );

        router.refresh();

        return;
      }


      /*
       * Normal legacy beta fallback.
       */
      const response =
        await fetch(
          "/api/auth/login",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                {
                  teamId:
                    Number(
                      selectedTeamId,
                    ),

                  pin,
                },
              ),
          },
        );


      const result =
        await response
          .json();


      if (
        !response.ok
      ) {
        setMessage(
          result.error ||
            "Login failed.",
        );

        return;
      }


      router.push(
        "/",
      );

      router.refresh();
    } catch (
      error
    ) {
      console.error(
        error,
      );

      setMessage(
        "Unable to sign in.",
      );
    } finally {
      setIsSubmitting(
        false,
      );
    }
  }


  function cancelPendingLink() {
    sessionStorage.removeItem(
      PENDING_AUTH_TOKEN_KEY,
    );

    setPendingAccessToken(
      null,
    );

    setPin(
      "",
    );

    setMessage(
      "",
    );


    try {
      const supabase =
        getSupabaseBrowserClient();

      void supabase
        .auth
        .signOut();
    } catch {
      // Nothing else to clean up.
    }
  }


  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-xl">

        <div className="mb-6 text-center">
          <div className="text-4xl">
            🏆
          </div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            111 Sports
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Sign in to your Groups, leagues, stats, and drafts.
          </p>
        </div>


        {message ? (
          <div className="mb-5 rounded-2xl border border-sky-800 bg-sky-950/60 px-4 py-3 text-sm text-sky-100">
            {message}
          </div>
        ) : null}


        {!pendingAccessToken ? (
          <>
            <button
              type="button"
              onClick={
                handleGoogleSignIn
              }
              disabled={
                isSubmitting
              }
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-600 bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
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


            <form
              className="space-y-4"
              onSubmit={
                handleEmailLogin
              }
            >
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-slate-300"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={
                    email
                  }
                  onChange={
                    (
                      event,
                    ) =>
                      setEmail(
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="you@example.com"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-900"
                />
              </div>


              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-semibold text-slate-300"
                >
                  Password
                </label>

                <div className="relative">
                  <input
                    id="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete="current-password"
                    value={
                      password
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        setPassword(
                          event
                            .target
                            .value,
                        )
                    }
                    placeholder="Password"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 pr-20 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-900"
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


              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !email.trim() ||
                  !password
                }
                className="w-full rounded-2xl bg-sky-600 px-4 py-3 font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting
                  ? "Signing in…"
                  : "Sign in with email"}
              </button>
            </form>


            <p className="mt-4 text-center text-xs leading-5 text-slate-500">
              New accounts are invite-only. Account creation will appear when you open a valid Group invitation.
            </p>


            <button
              type="button"
              onClick={() =>
                setShowLegacyLogin(
                  (
                    current,
                  ) =>
                    !current,
                )
              }
              className="mt-5 w-full text-center text-sm font-semibold text-sky-400 hover:text-sky-300"
            >
              {showLegacyLogin
                ? "Hide league PIN login"
                : "Use league PIN instead"}
            </button>
          </>
        ) : null}


        {showLegacyLogin ? (
          <div className={pendingAccessToken ? "" : "mt-5 border-t border-slate-700 pt-5"}>

            <div className="mb-4">
              <h2 className="font-bold text-white">
                {pendingAccessToken
                  ? "Link your existing account"
                  : "League PIN login"}
              </h2>

              <p className="mt-1 text-xs leading-5 text-slate-400">
                {pendingAccessToken
                  ? "This is a one-time link. Choose your existing 111 identity and enter its current PIN."
                  : "Temporary fallback during the Groups beta."}
              </p>
            </div>


            <form
              className="space-y-4"
              onSubmit={
                handleLegacySubmit
              }
            >
              <div>
                <label
                  htmlFor="team"
                  className="mb-2 block text-sm font-semibold text-slate-300"
                >
                  Who are you?
                </label>

                <select
                  id="team"
                  value={
                    selectedTeamId
                  }
                  onChange={
                    (
                      event,
                    ) =>
                      setSelectedTeamId(
                        event
                          .target
                          .value,
                      )
                  }
                  disabled={
                    isLoadingTeams
                  }
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-900"
                >
                  {teams.map(
                    (
                      team,
                    ) => (
                      <option
                        key={
                          team.id
                        }
                        value={
                          team.id
                        }
                      >
                        {team.name}
                      </option>
                    ),
                  )}
                </select>
              </div>


              <div>
                <label
                  htmlFor="pin"
                  className="mb-2 block text-sm font-semibold text-slate-300"
                >
                  PIN
                </label>

                <div className="relative">
                  <input
                    id="pin"
                    type={
                      showPin
                        ? "text"
                        : "password"
                    }
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="current-password"
                    value={
                      pin
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        setPin(
                          event
                            .target
                            .value
                            .replace(
                              /\D/g,
                              "",
                            )
                            .slice(
                              0,
                              8,
                            ),
                        )
                    }
                    placeholder="Enter PIN"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 pr-20 text-center text-xl font-bold tracking-[0.3em] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-900"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPin(
                        (
                          current,
                        ) =>
                          !current,
                      )
                    }
                    className="absolute inset-y-0 right-0 px-4 text-xs font-semibold text-sky-400"
                  >
                    {showPin
                      ? "Hide"
                      : "Show"}
                  </button>
                </div>
              </div>


              <button
                type="submit"
                disabled={
                  isLoadingTeams ||
                  isSubmitting ||
                  !selectedTeamId ||
                  pin.length <
                    4
                }
                className="w-full rounded-2xl bg-slate-700 px-4 py-3 font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting
                  ? pendingAccessToken
                    ? "Linking…"
                    : "Signing in…"
                  : pendingAccessToken
                    ? "Link account & continue"
                    : "Continue with PIN"}
              </button>
            </form>


            {pendingAccessToken ? (
              <button
                type="button"
                onClick={
                  cancelPendingLink
                }
                className="mt-4 w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                Cancel and use another sign-in
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
