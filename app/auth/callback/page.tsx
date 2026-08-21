"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  getSupabaseBrowserClient,
} from "@/lib/supabaseBrowser";


const PENDING_AUTH_TOKEN_KEY =
  "111_pending_auth_access_token";


export default function AuthCallbackPage() {
  const router =
    useRouter();

  const [
    message,
    setMessage,
  ] =
    useState(
      "Finishing your 111 Sports sign in…",
    );


  useEffect(
    () => {
      let cancelled =
        false;


      async function finishSignIn() {
        try {
          const supabase =
            getSupabaseBrowserClient();


          /*
           * detectSessionInUrl is enabled on the browser client.
           * Give Supabase Auth a moment to consume the OAuth
           * callback fragment before treating an empty session
           * as failure.
           */
          let session =
            (
              await supabase
                .auth
                .getSession()
            ).data
              .session;


          if (
            !session
          ) {
            await new Promise(
              (
                resolve,
              ) =>
                setTimeout(
                  resolve,
                  250,
                ),
            );


            session =
              (
                await supabase
                  .auth
                  .getSession()
              ).data
                .session;
          }


          if (
            !session
          ) {
            throw new Error(
              "No Supabase authentication session was returned.",
            );
          }


          const accessToken =
            session
              .access_token;


          /*
           * If authentication began from a Group invitation,
           * consume that invite BEFORE bridging into the normal
           * 111 Sports application session.
           *
           * This handles:
           *   - Google OAuth;
           *   - email confirmation after sign-up.
           */
          const searchParams =
            new URLSearchParams(
              window.location.search,
            );


          const inviteToken =
            String(
              searchParams.get(
                "invite",
              ) ??
                "",
            ).trim();


          if (
            inviteToken
          ) {
            const inviteResponse =
              await fetch(
                `/api/group-invites/${encodeURIComponent(
                  inviteToken,
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
                    }),
                },
              );


            const inviteResult =
              await inviteResponse
                .json();


            if (
              !inviteResponse.ok
            ) {
              await supabase
                .auth
                .signOut();


              throw new Error(
                inviteResult.error ||
                  "Unable to accept your Group invitation.",
              );
            }
          }


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


            /*
             * The rest of 111 Sports uses its own secure
             * HttpOnly session. We do not leave a second
             * persistent Supabase browser session behind.
             */
            await supabase
              .auth
              .signOut();


            if (
              !cancelled
            ) {
              router.replace(
                "/",
              );

              router.refresh();
            }

            return;
          }


          if (
            response.status ===
              409 &&
            result.code ===
              "ACCOUNT_LINK_REQUIRED"
          ) {
            sessionStorage.setItem(
              PENDING_AUTH_TOKEN_KEY,
              accessToken,
            );


            if (
              !cancelled
            ) {
              router.replace(
                "/login?link=existing",
              );
            }

            return;
          }


          await supabase
            .auth
            .signOut();


          throw new Error(
            result.error ||
              "Unable to complete sign in.",
          );
        } catch (
          error
        ) {
          console.error(
            error,
          );


          if (
            !cancelled
          ) {
            setMessage(
              error instanceof
                Error
                ? error.message
                : "Unable to complete sign in.",
            );
          }
        }
      }


      void finishSignIn();


      return () => {
        cancelled =
          true;
      };
    },
    [
      router,
    ],
  );


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
          {message}
        </p>
      </section>
    </main>
  );
}
