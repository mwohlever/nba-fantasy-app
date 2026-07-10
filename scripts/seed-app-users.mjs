import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { randomBytes, scrypt as nodeScrypt } from "crypto";
import { promisify } from "util";

const scrypt = promisify(nodeScrypt);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const requiredPins = {
  Mark: process.env.MARK_PIN,
  Andy: process.env.ANDY_PIN,
  Jon: process.env.JON_PIN,
  Josh: process.env.JOSH_PIN,
};

for (const [name, pin] of Object.entries(requiredPins)) {
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    console.error(`${name}'s PIN must contain 4–8 digits.`);
    process.exit(1);
  }
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function hashPin(pin, salt) {
  const derivedKey = await scrypt(pin, salt, 64);
  return Buffer.from(derivedKey).toString("hex");
}

const { data: teams, error: teamsError } = await supabase
  .from("teams")
  .select("id, name")
  .order("id");

if (teamsError) {
  console.error(`Failed to load teams: ${teamsError.message}`);
  process.exit(1);
}

console.log("Teams found:");
for (const team of teams ?? []) {
  console.log(`- ${team.id}: ${team.name}`);
}

const normalizedTeams = new Map(
  (teams ?? []).map((team) => [team.name.trim().toLowerCase(), team])
);

for (const [displayName, pin] of Object.entries(requiredPins)) {
  const team = normalizedTeams.get(displayName.toLowerCase());

  if (!team) {
    console.error(
      `Could not find a team named "${displayName}". No users were changed for this entry.`
    );
    process.exitCode = 1;
    continue;
  }

  const salt = randomBytes(16).toString("hex");
  const pinHash = await hashPin(pin, salt);

  const { error } = await supabase.from("app_users").upsert(
    {
      team_id: team.id,
      display_name: displayName,
      role: displayName === "Mark" ? "admin" : "player",
      pin_salt: salt,
      pin_hash: pinHash,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "team_id",
    }
  );

  if (error) {
    console.error(`Failed to create ${displayName}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }

  console.log(
    `Created/updated ${displayName} as ${
      displayName === "Mark" ? "admin" : "player"
    }.`
  );
}

if (!process.exitCode) {
  console.log("League identities are ready.");
}
