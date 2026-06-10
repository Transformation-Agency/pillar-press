export function isLocalFirstMode(): boolean {
  return (
    process.env.KINGS_PRESS_LOCAL_FIRST === "true" ||
    process.env.DATA_BACKEND === "sqlite" ||
    Boolean(process.env.KINGS_PRESS_DB_PATH)
  );
}
