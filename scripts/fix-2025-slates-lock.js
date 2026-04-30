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

async function run() {
  const { error } = await supabase
    .from("slates")
    .update({ is_locked: true })
    .gte("start_date", "2025-01-01")
    .lte("start_date", "2025-12-31");

  if (error) {
    console.error("❌ Error:", error.message);
    return;
  }

  console.log("✅ All 2025 slates set to locked");
}

run();
