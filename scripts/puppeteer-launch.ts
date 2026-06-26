import { existsSync } from "node:fs";
import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";

const macBrowserCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

function browserExecutablePath() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;
  if (process.platform !== "darwin") return undefined;
  return macBrowserCandidates.find((candidate) => existsSync(candidate));
}

export async function launchProofBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const executablePath = browserExecutablePath();
  return puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...options,
    ...(executablePath ? { executablePath } : {}),
  });
}
