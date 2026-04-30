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

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

async function run() {
  const { data: players } = await supabase
    .from("players")
    .select("id, name");

  const map = {};

  for (const p of players) {
    const key = normalize(p.name);
    map[key] ??= [];
    map[key].push(p);
  }

  Object.values(map)
    .filter(group => group.length > 1)
    .forEach(group => {
      console.log("\nDuplicate group:");
      group.forEach(p => console.log(p.id, p.name));
    });
}

run();
