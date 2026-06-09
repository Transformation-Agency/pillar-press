import { lstat, mkdtemp, readdir, readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const appPath = join(root, "src-tauri", "target", "release", "bundle", "macos", "King's Press Editorial Desk.app");
const dmgPath = join(root, "src-tauri", "target", "release", "bundle", "dmg", "King's Press Editorial Desk_0.1.0_aarch64.dmg");
const appResources = join(appPath, "Contents", "Resources");
const requireDeveloperId =
  process.argv.includes("--require-developer-id") || process.env.KINGS_PRESS_REQUIRE_DEVELOPER_ID === "true";
const requireNotarized =
  process.argv.includes("--require-notarized") || process.env.KINGS_PRESS_REQUIRE_NOTARIZED === "true";

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function assertExists(path: string, label: string) {
  if (!(await exists(path))) throw new Error(`Missing ${label}: ${path}`);
  console.log(`ok ${label}`);
}

async function resolveLauncherResource(name: string) {
  const candidates = [join(appResources, name), join(appResources, "resources", name)];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Launcher cannot resolve bundled resource ${name}. Checked:\n${candidates.join("\n")}`);
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

async function runCapture(command: string, args: string[], label: string) {
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

async function findEnvFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findEnvFiles(path)));
    else if (entry.name === ".env" || entry.name.startsWith(".env.")) out.push(path);
  }
  return out;
}

async function assertPlistValue(plistPath: string, key: string, expected: string) {
  const raw = await runCapture("plutil", ["-extract", key, "raw", "-o", "-", plistPath], `Info.plist ${key}`);
  const actual = raw.trim();
  if (actual !== expected) {
    throw new Error(`Expected ${key}=${expected}, got ${actual}`);
  }
}

async function assertPlistBool(plistPath: string, key: string, expected: boolean) {
  const raw = await runCapture("plutil", ["-extract", key, "raw", "-o", "-", plistPath], `Info.plist ${key}`);
  const actual = raw.trim();
  if (actual !== String(expected)) {
    throw new Error(`Expected ${key}=${expected}, got ${actual}`);
  }
}

async function verifyAppBundleMetadata(bundlePath: string) {
  const plist = join(bundlePath, "Contents", "Info.plist");
  const resources = join(bundlePath, "Contents", "Resources");
  await assertExists(plist, "app Info.plist");
  await assertExists(join(resources, "icon.icns"), "app icon resource");
  await Promise.all([
    assertPlistValue(plist, "CFBundleDisplayName", "King's Press Editorial Desk"),
    assertPlistValue(plist, "CFBundleName", "King's Press Editorial Desk"),
    assertPlistValue(plist, "CFBundleIdentifier", "com.kingspress.editorialdesk"),
    assertPlistValue(plist, "CFBundleShortVersionString", "0.1.0"),
    assertPlistValue(plist, "CFBundleIconFile", "icon.icns"),
    assertPlistBool(plist, "NSQuitAlwaysKeepsWindows", false),
  ]);
  console.log("ok app bundle metadata");
}

async function verifyDmgPayload() {
  const mountDir = await mkdtemp(join(tmpdir(), "kings-press-dmg-mount-"));
  let attached = false;
  try {
    await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mountDir, dmgPath], "DMG mount");
    attached = true;
    const mountedApp = join(mountDir, "King's Press Editorial Desk.app");
    const applicationsLink = join(mountDir, "Applications");
    await assertExists(mountedApp, "DMG app payload");

    const linkStat = await lstat(applicationsLink);
    if (!linkStat.isSymbolicLink()) {
      throw new Error(`Expected DMG Applications shortcut to be a symlink: ${applicationsLink}`);
    }
    const linkTarget = await readlink(applicationsLink);
    if (linkTarget !== "/Applications") {
      throw new Error(`Expected DMG Applications shortcut to target /Applications, got ${linkTarget}`);
    }
    console.log("ok DMG Applications shortcut");
    await verifyAppBundleMetadata(mountedApp);
  } finally {
    if (attached) {
      await run("hdiutil", ["detach", mountDir], "DMG detach");
    }
    await rm(mountDir, { recursive: true, force: true });
  }
}

async function verifyDeveloperIdSignature() {
  const details = await runCapture("codesign", ["-dv", "--verbose=4", appPath], "codesign details");
  if (/Signature=adhoc/.test(details)) {
    throw new Error("Expected a Developer ID signature, but the app is ad-hoc signed.");
  }
  if (/TeamIdentifier=not set/.test(details)) {
    throw new Error("Expected a Developer ID TeamIdentifier, but none is set.");
  }
  if (!/Authority=Developer ID Application/.test(details)) {
    throw new Error(`Expected Developer ID Application authority in codesign details.\n${details}`);
  }
  console.log("ok Developer ID signature");
}

async function verifyNotarization() {
  await run("xcrun", ["stapler", "validate", appPath], "app notarization ticket");
  await run("spctl", ["-a", "-vv", "-t", "install", dmgPath], "Gatekeeper DMG assessment");
}

async function verifyOfflineBrowserRuntime(bundledServerRoot: string) {
  const indexPath = join(bundledServerRoot, "public", "index.html");
  const index = await readFile(indexPath, "utf8");
  const forbidden = ["https://unpkg.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
  const hit = forbidden.find((value) => index.includes(value));
  if (hit) throw new Error(`Packaged browser shell still depends on remote startup asset: ${hit}`);
  await Promise.all([
    assertExists(join(bundledServerRoot, "public", "vendor", "react.production.min.js"), "local React browser runtime"),
    assertExists(join(bundledServerRoot, "public", "vendor", "react-dom.production.min.js"), "local ReactDOM browser runtime"),
    assertExists(join(bundledServerRoot, "public", "vendor", "babel.min.js"), "local Babel browser runtime"),
  ]);
  console.log("ok offline browser runtime");
}

async function waitForReady(port: number) {
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged server did not become ready on ${url}`);
}

async function smokePackagedServer(bundledNode: string, bundledServer: string, bundledServerRoot: string) {
  const dataDir = await mkdtemp(join(tmpdir(), "kings-press-release-smoke-"));
  const port = 3219;
  const child = spawn(bundledNode, [bundledServer], {
    cwd: bundledServerRoot,
    stdio: "pipe",
    env: {
      HOME: dataDir,
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      KINGS_PRESS_LOCAL_FIRST: "true",
      DATA_BACKEND: "sqlite",
      STORAGE_PROVIDER: "local",
      KINGS_PRESS_STORAGE: "local",
      KINGS_PRESS_DATA_DIR: dataDir,
      KINGS_PRESS_LLM_SETTINGS_PATH: join(dataDir, "desktop-settings.json"),
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      ANTHROPIC_API_KEY: "",
    },
  });

  try {
    await waitForReady(port);
    const [status, mediaProviders, campaigns, schedules] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/llm/status`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${port}/api/media/providers`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${port}/api/campaigns`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${port}/api/gather/schedules/run-due`, { method: "POST" }).then((r) => r.json()),
    ]);
    if (status.provider !== "ollama") throw new Error(`Unexpected LLM provider: ${JSON.stringify(status)}`);
    if (!Array.isArray(mediaProviders.providers) || mediaProviders.providers.length < 5) {
      throw new Error(`Expected media provider status list, got ${JSON.stringify(mediaProviders)}`);
    }
    if (mediaProviders.openai?.configured !== false || !mediaProviders.openai?.capabilities?.includes("audio")) {
      throw new Error(`Expected unconfigured OpenAI image/audio provider in clean smoke env, got ${JSON.stringify(mediaProviders.openai)}`);
    }
    if (mediaProviders.hedra?.configured !== false || !mediaProviders.hedra?.capabilities?.includes("video")) {
      throw new Error(`Expected unconfigured Hedra video provider in clean smoke env, got ${JSON.stringify(mediaProviders.hedra)}`);
    }
    if (JSON.stringify(mediaProviders).toLowerCase().includes("secret")) {
      throw new Error(`Media provider status leaked a secret-like value: ${JSON.stringify(mediaProviders)}`);
    }
    if (!Array.isArray(campaigns.campaigns) || campaigns.campaigns.length !== 0) {
      throw new Error(`Expected a clean install with no default campaigns, got ${JSON.stringify(campaigns)}`);
    }
    const created = await fetch(`http://127.0.0.1:${port}/api/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "First Campaign" }),
    }).then((r) => r.json());
    if (!created.campaign?.id) throw new Error(`Could not create first campaign: ${JSON.stringify(created)}`);
    const refs = await fetch(`http://127.0.0.1:${port}/api/campaigns/${created.campaign.id}/references`).then((r) => r.json());
    if (!Array.isArray(refs.references?.doc?.strategy?.throughlines) || refs.references.doc.strategy.throughlines.length !== 0) {
      throw new Error(`Expected blank first-campaign references, got ${JSON.stringify(refs)}`);
    }
    if (typeof schedules.ran !== "number") throw new Error(`Unexpected scheduler response: ${JSON.stringify(schedules)}`);
    console.log("ok packaged server smoke");
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
}

await assertExists(appPath, "macOS app bundle");
await assertExists(dmgPath, "macOS DMG");
const bundledServerRoot = await resolveLauncherResource("desktop-server");
const bundledNodeRoot = await resolveLauncherResource("node");
const bundledServer = join(bundledServerRoot, "server.js");
const bundledNode = join(bundledNodeRoot, "bin", process.platform === "win32" ? "node.exe" : "node");
await assertExists(bundledServer, "packaged Next server");
await assertExists(bundledNode, "bundled Node runtime");
console.log("ok launcher resource lookup");
await verifyAppBundleMetadata(appPath);

const envFiles = await findEnvFiles(bundledServerRoot);
if (envFiles.length) throw new Error(`Bundled server contains env files:\n${envFiles.join("\n")}`);
console.log("ok no bundled env files");
await verifyOfflineBrowserRuntime(bundledServerRoot);

if (process.platform === "darwin") {
  await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "codesign verification");
  if (requireDeveloperId) await verifyDeveloperIdSignature();
  await run("hdiutil", ["imageinfo", dmgPath], "DMG imageinfo");
  await verifyDmgPayload();
  if (requireNotarized) await verifyNotarization();
}

await smokePackagedServer(bundledNode, bundledServer, bundledServerRoot);
console.log("Desktop release verification passed.");
