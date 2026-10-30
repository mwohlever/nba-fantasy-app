import { createClient } from "@supabase/supabase-js";
import { playerCenterReadOnlyLocal } from "./player-center/feature";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    global: {
      fetch: (input, init) => {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const url = input instanceof Request ? input.url : String(input);
        if (playerCenterReadOnlyLocal() && (method !== "GET" && method !== "HEAD" || new URL(url).pathname.includes("/rpc/"))) {
          return Promise.resolve(new Response(JSON.stringify({ code: "LOCAL_READ_ONLY", message: "Database writes are disabled in local Player Center review mode." }), { status: 403, headers: { "Content-Type": "application/json" } }));
        }
        return fetch(input, init);
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
