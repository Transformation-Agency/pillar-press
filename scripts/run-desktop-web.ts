import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const command = process.argv[2] === "build" ? "build" : "dev";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const desktopDevPort = process.env.PILLAR_PRESS_DESKTOP_DEV_PORT || "41739";
const desktopDevHost = process.env.PILLAR_PRESS_DESKTOP_DEV_HOST || "127.0.0.1";
const args =
  command === "dev"
    ? ["run", command, "--", "--hostname", desktopDevHost, "--port", desktopDevPort]
    : ["run", command];

const desktopEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...(command === "dev" ? { NODE_ENV: "development" } : {}),
  PILLAR_PRESS_DESKTOP_DEV_HOST: desktopDevHost,
  PILLAR_PRESS_DESKTOP_DEV_PORT: desktopDevPort,
  PILLAR_PRESS_LOCAL_FIRST: "true",
  STORAGE_PROVIDER: "local",
};

const compile: ChildProcess = spawn(npmBin, ["run", "desktop:build-static-shell"], {
  stdio: "inherit",
  env: desktopEnv,
});

compile.on("exit", (compileCode: number | null, compileSignal: NodeJS.Signals | null) => {
  if (compileSignal) {
    process.kill(process.pid, compileSignal);
    return;
  }
  if (compileCode !== 0) {
    process.exit(compileCode ?? 1);
    return;
  }

  const child: ChildProcess = spawn(npmBin, args, {
    stdio: "inherit",
    env: desktopEnv,
  });

  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if (code !== 0 || command !== "build") {
      process.exit(code ?? 0);
      return;
    }

    const prepare = spawn(npmBin, ["run", "desktop:prepare-sidecar"], {
      stdio: "inherit",
      env: process.env,
    });
    prepare.on("exit", (prepareCode: number | null, prepareSignal: NodeJS.Signals | null) => {
      if (prepareSignal) {
        process.kill(process.pid, prepareSignal);
        return;
      }
      process.exit(prepareCode ?? 0);
    });
  });
});

compile.on("error", (error: Error) => {
  console.error(error);
  process.exit(1);
});

process.on("SIGTERM", () => {
  compile.kill("SIGTERM");
});

process.on("SIGINT", () => {
  compile.kill("SIGINT");
});
