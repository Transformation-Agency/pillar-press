import { homedir } from "node:os";
import { join } from "node:path";

const MAC_APP_DIR_NAME = "com.pillar.press";
const APP_DIR_NAME = "Pillar Press";

export function localDataDir(): string {
  const explicit = process.env.PILLAR_PRESS_DATA_DIR || process.env.LOCAL_DATA_DIR;
  if (explicit) return explicit;

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", MAC_APP_DIR_NAME);
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || homedir(), APP_DIR_NAME);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "pillar-press");
}

export function localDatabasePath(): string {
  return process.env.PILLAR_PRESS_DB_PATH || process.env.LOCAL_DATABASE_PATH || join(localDataDir(), "pillar-press.sqlite3");
}

export function localStorageDir(): string {
  return process.env.PILLAR_PRESS_STORAGE_DIR || join(localDataDir(), "storage");
}
