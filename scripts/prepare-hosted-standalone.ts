import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const standaloneDir = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");

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
    throw new Error(`Missing ${label} at ${from}. Run npm run web:build first.`);
  }
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
}

if (!(await exists(join(standaloneDir, "server.js")))) {
  throw new Error(`Missing hosted standalone server at ${join(standaloneDir, "server.js")}. Run npm run web:build first.`);
}

await copyRequiredDir(staticDir, join(standaloneDir, ".next", "static"), "Next static assets");
await copyRequiredDir(publicDir, join(standaloneDir, "public"), "public assets");

console.log(`Prepared hosted standalone server at ${standaloneDir}`);
