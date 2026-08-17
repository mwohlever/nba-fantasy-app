import fs from "fs";
import {
  createClient,
} from "@supabase/supabase-js";

const env =
  fs.readFileSync(
    ".env.local",
    "utf8",
  );

for (
  const line
  of env.split("\n")
) {
  const match =
    line.match(
      /^([^#=]+)=(.*)$/,
    );

  if (!match) continue;

  const [
    ,
    key,
    rawValue,
  ] = match;

  if (!process.env[key]) {
    process.env[key] =
      rawValue
        .trim()
        .replace(
          /^['"]|['"]$/g,
          "",
        );
  }
}

const supabase =
  createClient(
    process.env
      .NEXT_PUBLIC_SUPABASE_URL,
    process.env
      .SUPABASE_SERVICE_ROLE_KEY,
  );

const {
  count,
  error,
} =
  await supabase
    .from(
      "player_golf_season_stats",
    )
    .select(
      "*",
      {
        count:
          "exact",
        head:
          true,
      },
    )
    .eq(
      "season",
      2026,
    );

if (error) {
  throw error;
}

console.log(
  "2026 Golf season rows:",
  count,
);
