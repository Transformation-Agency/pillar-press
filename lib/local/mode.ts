type RuntimeEnv = Record<string, string | undefined>;

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((value ?? "").trim());
}

function falsy(value: string | undefined): boolean {
  return /^(0|false|no)$/i.test((value ?? "").trim());
}

export function isHostedWebMode(env: RuntimeEnv = process.env): boolean {
  const runtime = (env.PILLAR_PRESS_RUNTIME ?? "").trim().toLowerCase();
  return (
    runtime === "hosted" ||
    runtime === "web" ||
    truthy(env.PILLAR_PRESS_HOSTED_WEB) ||
    falsy(env.PILLAR_PRESS_LOCAL_FIRST) ||
    env.DATA_BACKEND === "postgres"
  );
}

export function isLocalFirstMode(env: RuntimeEnv = process.env): boolean {
  if (isHostedWebMode(env)) return false;
  return (
    env.PILLAR_PRESS_LOCAL_FIRST === "true" ||
    env.DATA_BACKEND === "sqlite" ||
    Boolean((env.PILLAR_PRESS_DB_PATH ?? "").trim())
  );
}
