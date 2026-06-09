import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "King's Press Editorial Desk";

export function localDataDir(): string {
  const explicit = process.env.KINGS_PRESS_DATA_DIR || process.env.LOCAL_DATA_DIR;
  if (explicit) return explicit;

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || homedir(), APP_DIR_NAME);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "kings-press-editorial-desk");
}

export function localDatabasePath(): string {
  return process.env.KINGS_PRESS_DB_PATH || process.env.LOCAL_DATABASE_PATH || join(localDataDir(), "kings-press.sqlite3");
}

export function localStorageDir(): string {
  return process.env.KINGS_PRESS_STORAGE_DIR || join(localDataDir(), "storage");
}
