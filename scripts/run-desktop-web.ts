import { spawn } from "node:child_process";

const command = process.argv[2] === "build" ? "build" : "dev";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const child = spawn(npmBin, ["run", command], {
  stdio: "inherit",
  env: {
    ...process.env,
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
