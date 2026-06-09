import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dmgPath = join(root, "src-tauri", "target", "release", "bundle", "dmg", "King's Press Editorial Desk_0.1.0_aarch64.dmg");
const appName = "King's Press Editorial Desk.app";
const executableName = "kings-press-editorial-desk";

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function run(command: string, args: string[], label: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`ok ${label}`);
        resolve();
      } else {
        reject(new Error(`${label} failed with exit ${code}\n${out}`));
      }
    });
  });
}

function cleanLaunchEnv(homeDir: string, tmpDir: string, appDataDir: string): NodeJS.ProcessEnv {
  return {
    HOME: homeDir,
    TMPDIR: tmpDir,
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    NODE_ENV: process.env.NODE_ENV,
    KINGS_PRESS_DESKTOP_DATA_DIR: appDataDir,
  };
}

async function waitForServerUrl(appPid: number, appDataDir: string): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const status = await fetchCandidatePorts(appPid, appDataDir);
    if (status) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Installed app did not expose a reachable local King’s Press server.");
}

async function waitForAppPid(installedApp: string): Promise<number> {
  const executableMarker = `${installedApp}/Contents/MacOS/${executableName}`;
  for (let i = 0; i < 80; i += 1) {
    const ps = await capture("ps", ["-axo", "pid,command"], "process list").catch(() => "");
    const matches = ps
      .split("\n")
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: Number(match[1]), command: match[2] };
      })
      .filter((process): process is { pid: number; command: string } =>
        !!process && process.command.includes(executableMarker));
    const match = matches[matches.length - 1];
    if (match) return match.pid;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Installed app did not launch a visible app process.");
}

async function fetchCandidatePorts(appPid: number, appDataDir: string): Promise<string | null> {
  const ps = await capture("ps", ["-axo", "pid,ppid,command"], "process list").catch(() => "");
  const childPids = ps
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
    })
    .filter((process): process is { pid: number; ppid: number; command: string } =>
      !!process && process.ppid === appPid && process.command.includes("next-server"));
  const ports: number[] = [];
  for (const process of childPids) {
    const out = await capture("lsof", ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN"], "child lsof listeners").catch(() => "");
    ports.push(
      ...[...out.matchAll(/TCP 127\.0\.0\.1:(\d+) \(LISTEN\)/g)]
        .map((match) => Number(match[1]))
        .filter((port) => Number.isFinite(port)),
    );
  }
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/llm/status`);
      if (!res.ok) continue;
      const status = await res.json();
      const campaigns = await fetch(`http://127.0.0.1:${port}/api/campaigns`).then((r) => r.json());
      if (status?.provider === "ollama" && Array.isArray(campaigns?.campaigns)) {
        const dbPath = join(appDataDir, "kings-press.sqlite3");
        if (!(await exists(dbPath))) continue;
        return `http://127.0.0.1:${port}`;
      }
    } catch {
      // Try the next listener.
    }
  }
  return null;
}

async function capture(command: string, args: string[], label: string) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${label} failed with exit ${code}\n${out}`));
    });
  });
}

async function killPid(pid: number, signal = "TERM") {
  await capture("kill", [`-${signal}`, String(pid)], `kill ${pid}`).catch(() => "");
}

async function stopAppPid(pid: number | null) {
  if (!pid) return;
  const ps = await capture("ps", ["-axo", "pid,ppid,command"], "process list").catch(() => "");
  const childPids = ps
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
    })
    .filter((process): process is { pid: number; ppid: number; command: string } =>
      !!process && process.ppid === pid);
  for (const child of childPids) await killPid(child.pid);
  await killPid(pid);
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of childPids) await killPid(child.pid, "KILL");
  await killPid(pid, "KILL");
}

if (process.platform !== "darwin") {
  console.log("skip installed app smoke: macOS DMG test only");
  process.exit(0);
}

if (!(await exists(dmgPath))) {
  throw new Error(`Missing release DMG: ${dmgPath}`);
}

const tmpRoot = await mkdtemp(join(tmpdir(), "kings-press-install-smoke-"));
const mountDir = join(tmpRoot, "mnt");
const installDir = join(tmpRoot, "Applications");
const homeDir = join(tmpRoot, "home");
const installedApp = join(installDir, appName);
const appDataDir = join(homeDir, "Library", "Application Support", "com.kingspress.editorialdesk");
let mounted = false;
let appPid: number | null = null;

try {
  await run("mkdir", ["-p", mountDir, installDir, homeDir], "install-smoke temp dirs");
  await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountDir, dmgPath], "install-smoke DMG mount");
  mounted = true;
  await run("ditto", [join(mountDir, appName), installedApp], "install-smoke app copy");
  await run("hdiutil", ["detach", mountDir], "install-smoke DMG detach");
  mounted = false;

  const executable = join(installedApp, "Contents", "MacOS", executableName);
  if (!(await exists(executable))) throw new Error(`Missing installed app executable: ${executable}`);
  const launchEnv = cleanLaunchEnv(homeDir, tmpRoot, appDataDir);
  const openArgs = ["-n", "-g", "-F"];
  for (const [key, value] of Object.entries(launchEnv)) {
    if (value !== undefined) openArgs.push("--env", `${key}=${value}`);
  }
  openArgs.push(installedApp);
  await run("open", openArgs, "install-smoke app launch");
  appPid = await waitForAppPid(installedApp);
  let serverUrl = "";
  try {
    serverUrl = await waitForServerUrl(appPid, appDataDir);
  } catch (error) {
    const startupLog = await readTextIfExists(join(appDataDir, "desktop-startup.log"));
    throw new Error([
      error instanceof Error ? error.message : String(error),
      startupLog ? `startup log:\n${startupLog.trim()}` : "startup log: <missing>",
    ].join("\n\n"));
  }
  const [status, campaigns, runtime] = await Promise.all([
    fetch(`${serverUrl}/api/llm/status`).then((r) => r.json()),
    fetch(`${serverUrl}/api/campaigns`).then((r) => r.json()),
    fetch(`${serverUrl}/api/media/providers`).then((r) => r.json()),
  ]);
  if (status.provider !== "ollama") throw new Error(`Expected clean installed app to default to Ollama, got ${JSON.stringify(status)}`);
  if (!Array.isArray(campaigns.campaigns) || campaigns.campaigns.length !== 0) {
    throw new Error(`Expected clean installed app to start without campaigns, got ${JSON.stringify(campaigns)}`);
  }
  if (!Array.isArray(runtime.providers) || runtime.providers.length < 5) {
    throw new Error(`Expected installed app media provider status, got ${JSON.stringify(runtime)}`);
  }
  for (const file of ["kings-press.sqlite3"]) {
    const path = join(appDataDir, file);
    if (!(await exists(path))) throw new Error(`Expected installed app to create ${path}`);
  }
  const startupLog = await readTextIfExists(join(appDataDir, "desktop-startup.log"));
  if (!startupLog.includes("server ready")) {
    throw new Error(`Expected installed app startup log to confirm server readiness, got:\n${startupLog || "<missing>"}`);
  }
  console.log(`ok installed app launches from copied DMG payload (${serverUrl})`);
} finally {
  await stopAppPid(appPid);
  if (mounted) {
    await run("hdiutil", ["detach", mountDir], "install-smoke DMG detach").catch(() => undefined);
  }
  await rm(tmpRoot, { recursive: true, force: true });
}
