import { chmod, cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const root = process.cwd();
const resourceDir = join(root, "src-tauri", "resources", "whisper");
const binDir = join(resourceDir, "bin");
const libDir = join(resourceDir, "lib");
const libexecDir = join(resourceDir, "libexec");
const modelDir = join(resourceDir, "models");
const binName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function envPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function maybeCopy(from: string | null, to: string, label: string): Promise<boolean> {
  if (!from) return false;
  if (!(await exists(from))) throw new Error(`${label} not found at ${from}`);
  await cp(from, to, { dereference: true });
  if (process.platform !== "win32") await chmod(to, 0o755);
  return true;
}

await mkdir(binDir, { recursive: true });
await mkdir(libDir, { recursive: true });
await mkdir(libexecDir, { recursive: true });
await mkdir(modelDir, { recursive: true });

const sourceBin = envPath("PILLAR_PRESS_WHISPER_BIN") || envPath("WHISPER_CPP_BIN");
const sourceModel = envPath("PILLAR_PRESS_WHISPER_MODEL") || envPath("WHISPER_CPP_MODEL");
const sourceLibDir =
  envPath("PILLAR_PRESS_WHISPER_LIB_DIR") ||
  envPath("WHISPER_CPP_LIB_DIR") ||
  (sourceBin ? resolve(dirname(sourceBin), "..", "lib") : null);
const sourceLibexecDir =
  envPath("PILLAR_PRESS_WHISPER_LIBEXEC_DIR") ||
  envPath("WHISPER_CPP_LIBEXEC_DIR") ||
  (sourceBin ? resolve(dirname(sourceBin), "..", "libexec") : null);

const copiedBin = await maybeCopy(
  sourceBin,
  join(binDir, binName),
  "Whisper CLI binary",
);
const copiedModel = await maybeCopy(
  sourceModel,
  join(modelDir, "ggml-tiny.en.bin"),
  "Whisper tiny model",
);
let copiedLibCount = 0;
if (sourceLibDir && await exists(sourceLibDir)) {
  for (const entry of await readdir(sourceLibDir)) {
    if (!entry.endsWith(".dylib")) continue;
    await cp(join(sourceLibDir, entry), join(libDir, entry), { dereference: true });
    await chmod(join(libDir, entry), 0o755);
    copiedLibCount += 1;
  }
}
let copiedBackendCount = 0;
if (sourceLibexecDir && await exists(sourceLibexecDir)) {
  for (const entry of await readdir(sourceLibexecDir)) {
    if (!entry.endsWith(".so") && !entry.endsWith(".dylib")) continue;
    await cp(join(sourceLibexecDir, entry), join(libexecDir, entry), { dereference: true });
    await chmod(join(libexecDir, entry), 0o755);
    copiedBackendCount += 1;
  }
}

await writeFile(
  join(resourceDir, "README.md"),
  [
    "# Pillar Press Whisper sidecar",
    "",
    "Place a whisper.cpp CLI binary at `bin/whisper-cli` and the tiny English model at `models/ggml-tiny.en.bin`.",
    "",
    "For local packaging, run:",
    "",
    "```sh",
    "PILLAR_PRESS_WHISPER_BIN=/path/to/whisper-cli \\",
    "PILLAR_PRESS_WHISPER_MODEL=/path/to/ggml-tiny.en.bin \\",
    "PILLAR_PRESS_WHISPER_LIB_DIR=/path/to/whisper/lib \\",
    "PILLAR_PRESS_WHISPER_LIBEXEC_DIR=/path/to/whisper/libexec \\",
    "npm run desktop:prepare-whisper",
    "```",
    "",
    "At runtime, those same environment variables can override the bundled paths for development.",
    "",
  ].join("\n"),
);

console.log(
  `Prepared Whisper resource folder at ${resourceDir} (${[
    copiedBin ? `binary ${basename(binName)}` : "binary missing",
    copiedLibCount ? `${copiedLibCount} dylib${copiedLibCount === 1 ? "" : "s"}` : "dylibs missing or not needed",
    copiedBackendCount ? `${copiedBackendCount} backend plugin${copiedBackendCount === 1 ? "" : "s"}` : "backend plugins missing or not needed",
    copiedModel ? "tiny model" : "model missing",
  ].join(", ")}).`,
);
