import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

const command = process.argv[2] === "build" ? "build" : "dev";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const npmSpawnOptions = { shell: process.platform === "win32" };
const desktopDevPort = process.env.PILLAR_PRESS_DESKTOP_DEV_PORT || "41739";
const desktopDevHost = process.env.PILLAR_PRESS_DESKTOP_DEV_HOST || "127.0.0.1";
const appDataDir =
  process.env.PILLAR_PRESS_DESKTOP_DATA_DIR ||
  process.env.PILLAR_PRESS_DATA_DIR ||
  (process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "com.pillar.press")
    : process.platform === "win32"
      ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "com.pillar.press")
      : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "com.pillar.press"));
if (!existsSync(appDataDir)) mkdirSync(appDataDir, { recursive: true });
const storageDir = process.env.PILLAR_PRESS_STORAGE_DIR || join(appDataDir, "storage");
if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });
const args =
  command === "dev"
    ? ["run", command, "--", "--hostname", desktopDevHost, "--port", desktopDevPort]
    : ["run", command];

function desktopSettingsKeyFromKeychain(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const keychain = execFileSync("security", ["default-keychain", "-d", "user"], { encoding: "utf8" })
      .trim()
      .replace(/^"|"$/g, "");
    const secret = execFileSync("security", [
      "find-generic-password",
      "-w",
      "-s",
      "Pillar Press Desktop Settings",
      "-a",
      "llm-settings",
      keychain,
    ], { encoding: "utf8" }).trim();
    return Buffer.from(secret, "base64").length === 32 ? secret : undefined;
  } catch {
    return undefined;
  }
}

const desktopSettingsKey = process.env.PILLAR_PRESS_DESKTOP_SETTINGS_KEY || desktopSettingsKeyFromKeychain();

const desktopEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...(command === "dev" ? { NODE_ENV: "development" } : {}),
  PILLAR_PRESS_DESKTOP_DEV_HOST: desktopDevHost,
  PILLAR_PRESS_DESKTOP_DEV_PORT: desktopDevPort,
  PILLAR_PRESS_LOCAL_FIRST: "true",
  PILLAR_PRESS_DATA_DIR: appDataDir,
  PILLAR_PRESS_DB_PATH: process.env.PILLAR_PRESS_DB_PATH || join(appDataDir, "pillar-press.sqlite3"),
  PILLAR_PRESS_STORAGE_DIR: storageDir,
  PILLAR_PRESS_LLM_SETTINGS_PATH: process.env.PILLAR_PRESS_LLM_SETTINGS_PATH || join(appDataDir, "desktop-settings.json"),
  ...(desktopSettingsKey ? { PILLAR_PRESS_DESKTOP_SETTINGS_KEY: desktopSettingsKey } : {}),
  NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=4096",
  STORAGE_PROVIDER: "local",
  PILLAR_PRESS_STORAGE: "local",
};

function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") cleaned[key] = value;
  }
  return cleaned;
}

const compile: ChildProcess = spawn(npmBin, ["run", "desktop:build-static-shell"], {
  stdio: "inherit",
  env: cleanEnv(desktopEnv) as NodeJS.ProcessEnv,
  ...npmSpawnOptions,
});

compile.on("exit", (compileCode: number | null, compileSignal: NodeJS.Signals | null) => {
  if (compileSignal) {
    process.kill(process.pid, compileSignal);
    return;
  }
  if (compileCode !== 0) {
    process.exit(compileCode ?? 1);
    return;
  }

  const child: ChildProcess = spawn(npmBin, args, {
    stdio: "inherit",
    env: cleanEnv(desktopEnv) as NodeJS.ProcessEnv,
    ...npmSpawnOptions,
  });

  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code !== 0 || command !== "build") {
      process.exit(code ?? 0);
      return;
    }

    const prepare = spawn(npmBin, ["run", "desktop:prepare-sidecar"], {
      stdio: "inherit",
      env: cleanEnv(process.env) as NodeJS.ProcessEnv,
      ...npmSpawnOptions,
    });
    prepare.on("exit", (prepareCode: number | null, prepareSignal: NodeJS.Signals | null) => {
      if (prepareSignal) {
        process.kill(process.pid, prepareSignal);
        return;
      }
      process.exit(prepareCode ?? 0);
    });
  });
});

compile.on("error", (error: Error) => {
  console.error(error);
  process.exit(1);
});

process.on("SIGTERM", () => {
  compile.kill("SIGTERM");
});

process.on("SIGINT", () => {
  compile.kill("SIGINT");
});
