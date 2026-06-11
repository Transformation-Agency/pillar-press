import { spawn } from "node:child_process";

const allowed = new Set(["dev", "build", "start"]);
const command = allowed.has(process.argv[2] ?? "") ? process.argv[2]! : "dev";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const env: NodeJS.ProcessEnv = {
  ...process.env,
  KINGS_PRESS_RUNTIME: "hosted",
  KINGS_PRESS_HOSTED_WEB: "true",
  KINGS_PRESS_LOCAL_FIRST: "false",
  DATA_BACKEND: process.env.DATA_BACKEND === "sqlite" ? "postgres" : (process.env.DATA_BACKEND || "postgres"),
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER === "local" ? "supabase" : (process.env.STORAGE_PROVIDER || "supabase"),
  KINGS_PRESS_STORAGE: process.env.KINGS_PRESS_STORAGE === "local" ? "supabase" : (process.env.KINGS_PRESS_STORAGE || "supabase"),
  KINGS_PRESS_DB_PATH: "",
  KINGS_PRESS_DATA_DIR: "",
  KINGS_PRESS_STORAGE_DIR: "",
};

if (command !== "build") {
  const missing = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((key) => !env[key]);
  if (missing.length) {
    console.warn(`Hosted web mode is missing ${missing.join(", ")}. API routes that need hosted data/storage may fail until those env vars are set.`);
  }
}

const child = spawn(npmBin, ["run", command], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
