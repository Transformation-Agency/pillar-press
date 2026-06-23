import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const workbookPath = join(process.cwd(), "docs", "kings-press-feature-status.xlsx");
const sheetPath = "xl/worksheets/sheet1.xml";
const nonBlockingStatuses = new Set([
  "Retest passed",
  "Not independently verified (hosted; out of local-first scope)",
]);

function unzipText(path: string): string {
  return execFileSync("unzip", ["-p", workbookPath, path], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function sharedStrings(): string[] {
  let xml = "";
  try {
    xml = unzipText("xl/sharedStrings.xml");
  } catch {
    return [];
  }
  return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((match) => {
    return Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((textMatch) => decodeXml(textMatch[1]))
      .join("");
  });
}

function sheetCells(sheetXml: string, strings: string[]): Map<string, string> {
  const cells = new Map<string, string>();
  for (const match of sheetXml.matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const ref = attrs.match(/\br="([^"]+)"/)?.[1];
    if (!ref) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    const raw = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
    const inline = Array.from(body.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g))
      .map((textMatch) => decodeXml(textMatch[1]))
      .join("");
    if (inline) {
      cells.set(ref, inline);
      continue;
    }
    if (!raw) {
      cells.set(ref, "");
      continue;
    }
    cells.set(ref, type === "s" ? (strings[Number(raw)] ?? "") : decodeXml(raw));
  }
  return cells;
}

type TrackerRow = {
  row: number;
  storyId: string;
  featureArea: string;
  feature: string;
  testStatus: string;
  evidenceStatus: string;
  priority: string;
  errorsFound: string;
};

function trackerRows(): TrackerRow[] {
  if (!existsSync(workbookPath)) throw new Error(`Missing canonical tracker workbook: ${workbookPath}`);
  const strings = sharedStrings();
  const cells = sheetCells(unzipText(sheetPath), strings);
  const rows: TrackerRow[] = [];
  for (let row = 2; row <= 200; row += 1) {
    const storyId = cells.get(`A${row}`)?.trim();
    if (!storyId) continue;
    rows.push({
      row,
      storyId,
      featureArea: cells.get(`B${row}`)?.trim() ?? "",
      feature: cells.get(`C${row}`)?.trim() ?? "",
      evidenceStatus: cells.get(`G${row}`)?.trim() ?? "",
      testStatus: cells.get(`I${row}`)?.trim() ?? "",
      errorsFound: cells.get(`K${row}`)?.trim() ?? "",
      priority: cells.get(`L${row}`)?.trim() ?? "",
    });
  }
  return rows;
}

const rows = trackerRows();
const counts = rows.reduce<Record<string, number>>((acc, row) => {
  acc[row.testStatus] = (acc[row.testStatus] || 0) + 1;
  return acc;
}, {});
const blocking = rows.filter((row) => !nonBlockingStatuses.has(row.testStatus));

console.log(`King's Press release readiness from ${workbookPath}`);
console.log(JSON.stringify({ totalStories: rows.length, statusCounts: counts }, null, 2));

if (blocking.length) {
  console.error("\nRelease is not ready. Remaining blocking or unwaived tracker rows:");
  for (const row of blocking) {
    console.error(`- ${row.storyId} (${row.priority}) ${row.featureArea} / ${row.feature}: ${row.testStatus}`);
    if (row.errorsFound) console.error(`  ${row.errorsFound}`);
  }
  console.error("\nDo not build/notarize/upload final release DMGs until these rows pass or are explicitly waived in the tracker.");
  process.exit(1);
}

console.log("Release readiness passed: no unwaived tracker blockers remain.");
