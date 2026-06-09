import { chmod, cp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const standaloneDir = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");
const resourceDir = join(root, "src-tauri", "resources", "desktop-server");
const nodeResourceDir = join(root, "src-tauri", "resources", "node");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyRequiredDir(from: string, to: string, label: string) {
  if (!(await exists(from))) {
    throw new Error(`Missing ${label} at ${from}. Run the Next standalone build first.`);
  }
  await cp(from, to, { recursive: true });
}

async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}`));
    });
  });
}

async function runCapture(command: string, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}\n${out}`));
    });
  });
}

async function linkedLibraries(path: string) {
  if (process.platform !== "darwin") return [];
  const output = await runCapture("otool", ["-L", path]);
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().match(/^(.+?)\s+\(compatibility version/)?.[1])
    .filter((value): value is string => Boolean(value));
}

function shouldBundleDylib(path: string) {
  return (
    process.platform === "darwin" &&
    path.startsWith("/") &&
    !path.startsWith("/usr/lib/") &&
    !path.startsWith("/System/")
  );
}

function resolveBundledDylib(linkedPath: string, fromFile: string) {
  if (shouldBundleDylib(linkedPath)) {
    return { installName: linkedPath, sourcePath: linkedPath, targetName: basename(linkedPath) };
  }
  if (process.platform === "darwin" && linkedPath.startsWith("@loader_path/")) {
    const targetName = basename(linkedPath);
    return {
      installName: linkedPath,
      sourcePath: join(dirname(fromFile), linkedPath.slice("@loader_path/".length)),
      targetName,
    };
  }
  if (process.platform === "darwin" && linkedPath.startsWith("@rpath/")) {
    const targetName = basename(linkedPath);
    return {
      installName: linkedPath,
      sourcePath: join(dirname(fromFile), targetName),
      targetName,
    };
  }
  return null;
}

async function copyNodeRuntime() {
  const nodePath = await realpath(process.execPath);
  if (!(await exists(nodePath))) {
    throw new Error(`Could not find the build Node runtime at ${nodePath}.`);
  }
  const binName = process.platform === "win32" ? "node.exe" : "node";
  const binDir = join(nodeResourceDir, "bin");
  const libDir = join(nodeResourceDir, "lib");
  const target = join(binDir, binName);
  await rm(nodeResourceDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(libDir, { recursive: true });
  await cp(nodePath, target, { dereference: true });
  if (process.platform !== "win32") await chmod(target, 0o755);

  const bundledDylibs = new Map<string, string>();
  if (process.platform === "darwin") {
    const queue = [nodePath];
    const seen = new Set<string>();
    for (let i = 0; i < queue.length; i += 1) {
      const current = queue[i];
      if (seen.has(current)) continue;
      seen.add(current);
      for (const lib of await linkedLibraries(current)) {
        const resolved = resolveBundledDylib(lib, current);
        if (!resolved) continue;
        const libSource = await realpath(resolved.sourcePath);
        const libTarget = join(libDir, resolved.targetName);
        if (!bundledDylibs.has(lib)) {
          await cp(libSource, libTarget, { dereference: true });
          await chmod(libTarget, 0o755);
          bundledDylibs.set(lib, libTarget);
          queue.push(libSource);
        }
      }
    }

    for (const [originalPath, copiedPath] of bundledDylibs) {
      const nodeRelativePath = `@executable_path/../lib/${basename(copiedPath)}`;
      await run("install_name_tool", ["-change", originalPath, nodeRelativePath, target]);
    }

    for (const [originalPath, copiedPath] of bundledDylibs) {
      await run("install_name_tool", ["-id", `@loader_path/${basename(copiedPath)}`, copiedPath]);
      for (const linked of await linkedLibraries(copiedPath)) {
        const copiedDependency = bundledDylibs.get(linked);
        if (copiedDependency) {
          await run("install_name_tool", [
            "-change",
            linked,
            `@loader_path/${basename(copiedDependency)}`,
            copiedPath,
          ]);
        }
      }
    }
  }

  await writeFile(
    join(nodeResourceDir, "runtime.json"),
    JSON.stringify({
      copiedFrom: nodePath,
      sourceName: basename(nodePath),
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      bin: `bin/${binName}`,
      dylibs: [...bundledDylibs.values()].map((path) => `lib/${basename(path)}`),
    }, null, 2),
  );
}

async function pruneHostedOnlyPackages() {
  const packages = [
    "googleapis",
    "google-auth-library",
    "googleapis-common",
    "gaxios",
    "gcp-metadata",
    "gtoken",
    "google-logging-utils",
    "bignumber.js",
    "json-bigint",
    "jwa",
    "jws",
    "ecdsa-sig-formatter",
    "url-template",
  ];
  for (const name of packages) {
    await rm(join(resourceDir, "node_modules", name), { recursive: true, force: true });
  }
}

await rm(resourceDir, { recursive: true, force: true });
await mkdir(resourceDir, { recursive: true });

await copyRequiredDir(standaloneDir, resourceDir, "Next standalone server");
await copyRequiredDir(staticDir, join(resourceDir, ".next", "static"), "Next static assets");
await copyRequiredDir(publicDir, join(resourceDir, "public"), "public assets");
await pruneHostedOnlyPackages();

for (const name of await readdir(resourceDir)) {
  if (name === ".env" || name.startsWith(".env.")) {
    await rm(join(resourceDir, name), { recursive: true, force: true });
  }
}

await copyNodeRuntime();

console.log(`Prepared Tauri desktop server resources at ${resourceDir}`);
console.log(`Prepared bundled Node runtime at ${nodeResourceDir}`);
