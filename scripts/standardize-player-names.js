const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const lines = fs.readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    process.env[key] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RENAMES = [
  { from: "T.J. McConnell", to: "TJ McConnell" },
  { from: "P.J. Washington", to: "PJ Washington" },
  { from: "Michael Porter Jr.", to: "Michael Porter Jr" },
  { from: "Jabari Smith Jr.", to: "Jabari Smith Jr" },
  { from: "Derrick Jones Jr.", to: "Derrick Jones Jr" },
];

async function run() {
  for (const rename of RENAMES) {
    const { error } = await supabase
      .from("players")
      .update({ name: rename.to })
      .eq("name", rename.from);

    if (error) {
      console.error(`❌ ${rename.from} → ${rename.to}:`, error.message);
      continue;
    }

    console.log(`✅ ${rename.from} → ${rename.to}`);
  }

  console.log("\nDone.");
}

run();
