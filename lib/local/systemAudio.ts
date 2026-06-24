import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalSystemSpeechResult {
  bytes: Buffer;
  contentType: string;
  extension: string;
  voice: string;
}

export async function synthesizeLocalSystemSpeech(input: {
  text: string;
  voice?: string | null;
}): Promise<LocalSystemSpeechResult> {
  if (process.platform !== "darwin") {
    throw new Error("Local system speech export is available in the macOS desktop app.");
  }
  const text = input.text.trim();
  if (!text) throw new Error("Provide text to save as audio.");
  const workDir = await mkdtemp(join(tmpdir(), "kings-press-tts-"));
  const inputPath = join(workDir, `${randomUUID()}.txt`);
  const outputPath = join(workDir, `${randomUUID()}.aiff`);
  try {
    await writeFile(inputPath, text, "utf8");
    const args = ["-o", outputPath, "-f", inputPath];
    const voice = input.voice?.trim();
    if (voice && !/^system(?:-default)?$/i.test(voice)) args.unshift("-v", voice);
    await execFileAsync("/usr/bin/say", args, { timeout: 180_000, maxBuffer: 1024 * 1024 });
    return {
      bytes: await readFile(outputPath),
      contentType: "audio/aiff",
      extension: "aiff",
      voice: voice || "system-default",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
