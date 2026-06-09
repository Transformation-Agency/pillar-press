import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const appPath = join(root, "src-tauri", "target", "release", "bundle", "macos", "King's Press Editorial Desk.app");
const dmgPath = join(root, "src-tauri", "target", "release", "bundle", "dmg", "King's Press Editorial Desk_0.1.0_aarch64.dmg");

function required(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function hasApiKeyNotaryCredentials() {
  return Boolean(required("APPLE_API_KEY") && required("APPLE_API_ISSUER") && required("APPLE_API_KEY_PATH"));
}

function hasAppleIdNotaryCredentials() {
  return Boolean(required("APPLE_ID") && required("APPLE_PASSWORD") && required("APPLE_TEAM_ID"));
}

function notaryKeychainProfile() {
  return required("KINGS_PRESS_NOTARY_KEYCHAIN_PROFILE") || required("APPLE_NOTARY_KEYCHAIN_PROFILE");
}

function hasKeychainProfileCredentials() {
  return Boolean(notaryKeychainProfile());
}

function tauriBin() {
  const bin = process.platform === "win32" ? "tauri.cmd" : "tauri";
  return join(root, "node_modules", ".bin", bin);
}

async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}`));
    });
  });
}

function notarySubmitArgs(path: string) {
  const notaryArgs = ["notarytool", "submit", path, "--wait"];
  const profile = notaryKeychainProfile();
  if (profile) {
    notaryArgs.push("--keychain-profile", profile);
  } else if (hasApiKeyNotaryCredentials()) {
    notaryArgs.push(
      "--key",
      required("APPLE_API_KEY_PATH")!,
      "--key-id",
      required("APPLE_API_KEY")!,
      "--issuer",
      required("APPLE_API_ISSUER")!
    );
  } else {
    notaryArgs.push(
      "--apple-id",
      required("APPLE_ID")!,
      "--password",
      required("APPLE_PASSWORD")!,
      "--team-id",
      required("APPLE_TEAM_ID")!
    );
  }
  return notaryArgs;
}

async function notarizeApp(tempDir: string) {
  const zipPath = join(tempDir, "KingsPressEditorialDesk.app.zip");
  console.log("Zipping King’s Press app for notarization...");
  await run("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);
  console.log("Notarizing King’s Press app...");
  await run("xcrun", notarySubmitArgs(zipPath));
  console.log("Stapling King’s Press app...");
  await run("xcrun", ["stapler", "staple", appPath]);
}

async function notarizeDmg() {
  console.log("Notarizing King’s Press DMG...");
  await run("xcrun", notarySubmitArgs(dmgPath));
  console.log("Stapling King’s Press DMG...");
  await run("xcrun", ["stapler", "staple", dmgPath]);
}

if (process.platform !== "darwin") {
  throw new Error("Signed desktop release builds are currently configured for macOS only.");
}

const signingIdentity =
  required("KINGS_PRESS_SIGNING_IDENTITY") ||
  required("APPLE_SIGNING_IDENTITY") ||
  required("MACOS_SIGNING_IDENTITY");
const hasImportableCertificate = Boolean(required("APPLE_CERTIFICATE") && required("APPLE_CERTIFICATE_PASSWORD"));

if (!signingIdentity && !hasImportableCertificate) {
  throw new Error(
    [
      "Missing Developer ID signing credentials.",
      "Set KINGS_PRESS_SIGNING_IDENTITY, APPLE_SIGNING_IDENTITY, or MACOS_SIGNING_IDENTITY",
      "to a Developer ID Application certificate in the login keychain, or provide",
      "APPLE_CERTIFICATE plus APPLE_CERTIFICATE_PASSWORD for CI certificate import.",
    ].join(" ")
  );
}

if (!hasApiKeyNotaryCredentials() && !hasAppleIdNotaryCredentials() && !hasKeychainProfileCredentials()) {
  throw new Error(
    [
      "Missing Apple notarization credentials.",
      "Set APPLE_API_KEY, APPLE_API_ISSUER, and APPLE_API_KEY_PATH, or set",
      "APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID, or set",
      "APPLE_NOTARY_KEYCHAIN_PROFILE to a notarytool keychain profile.",
    ].join(" ")
  );
}

const providerShortName =
  required("KINGS_PRESS_PROVIDER_SHORT_NAME") ||
  required("APPLE_PROVIDER_SHORT_NAME") ||
  required("APPLE_TEAM_ID");
const tempDir = join(tmpdir(), `kings-press-signed-${Date.now()}`);
const configPath = join(tempDir, "tauri.signed.conf.json");

await mkdir(tempDir, { recursive: true });
try {
  const macOS: Record<string, unknown> = {
    signingIdentity: signingIdentity ?? null,
    hardenedRuntime: true,
  };
  if (providerShortName) macOS.providerShortName = providerShortName;

  await writeFile(
    configPath,
    JSON.stringify(
      {
        build: {
          beforeBundleCommand: "npm run desktop:sign-macos-resources",
        },
        bundle: {
          macOS,
        },
      },
      null,
      2
    )
  );

  console.log("Building Developer ID signed King’s Press desktop release...");
  await run(tauriBin(), ["build", "--ci", "--config", configPath]);
  if (hasKeychainProfileCredentials() && !hasApiKeyNotaryCredentials() && !hasAppleIdNotaryCredentials()) {
    await notarizeApp(tempDir);
  }
  await notarizeDmg();
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
