import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const resourceRoots = [
  join(root, "src-tauri", "resources", "desktop-server"),
  join(root, "src-tauri", "resources", "node"),
];
const nodeRuntimePath = join(root, "src-tauri", "resources", "node", "bin", "node");
const nodeEntitlementsPath = join(root, "src-tauri", "macos-node-entitlements.plist");

function required(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

const signingIdentity =
  required("KINGS_PRESS_SIGNING_IDENTITY") ||
  required("APPLE_SIGNING_IDENTITY") ||
  required("MACOS_SIGNING_IDENTITY");

if (process.platform !== "darwin") {
  console.log("Skipping macOS resource signing on non-macOS platform.");
  process.exit(0);
}

if (!signingIdentity) {
  throw new Error(
    "Missing signing identity. Set KINGS_PRESS_SIGNING_IDENTITY, APPLE_SIGNING_IDENTITY, or MACOS_SIGNING_IDENTITY."
  );
}
const activeSigningIdentity = signingIdentity;

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function shouldSign(path: string) {
  if (path.endsWith(".node") || path.endsWith(".dylib")) return true;
  return path === nodeRuntimePath;
}

async function codesign(path: string) {
  await new Promise<void>((resolve, reject) => {
    const args = ["--force", "--timestamp", "--options", "runtime"];
    if (path === nodeRuntimePath) {
      args.push("--entitlements", nodeEntitlementsPath);
    }
    args.push("--sign", activeSigningIdentity, path);
    const child = spawn(
      "codesign",
      args,
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("exit", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`codesign failed for ${path} with exit ${code}`));
    });
  });
}

const candidates: string[] = [];
for (const rootPath of resourceRoots) {
  if (await exists(rootPath)) {
    for (const file of await walk(rootPath)) {
      if (shouldSign(file)) candidates.push(file);
    }
  }
}

if (candidates.length === 0) {
  console.log("No macOS native desktop resources found to sign.");
  process.exit(0);
}

console.log(`Signing ${candidates.length} macOS native desktop resources with ${signingIdentity}...`);
for (const file of candidates) {
  await codesign(file);
}
console.log("Signed macOS native desktop resources.");
