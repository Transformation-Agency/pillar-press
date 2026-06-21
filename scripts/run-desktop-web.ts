import { spawn } from "node:child_process";

const command = process.argv[2] === "build" ? "build" : "dev";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const desktopDevPort = process.env.KINGS_PRESS_DESKTOP_DEV_PORT || "41739";
const desktopDevHost = process.env.KINGS_PRESS_DESKTOP_DEV_HOST || "127.0.0.1";
const args =
  command === "dev"
    ? ["run", command, "--", "--hostname", desktopDevHost, "--port", desktopDevPort]
    : ["run", command];

const child = spawn(npmBin, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    ...(command === "dev" ? { NODE_ENV: "development" } : {}),
    KINGS_PRESS_DESKTOP_DEV_HOST: desktopDevHost,
    KINGS_PRESS_DESKTOP_DEV_PORT: desktopDevPort,
    KINGS_PRESS_LOCAL_FIRST: "true",
    STORAGE_PROVIDER: "local",
  },
});

child.on("exit", (code, signal) => {
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
  prepare.on("exit", (prepareCode, prepareSignal) => {
    if (prepareSignal) {
      process.kill(process.pid, prepareSignal);
      return;
    }
    process.exit(prepareCode ?? 0);
  });
});
