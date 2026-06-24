import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workbookPath = join(process.cwd(), "docs", "kings-press-feature-status.xlsx");
const allowedStatuses = new Set([
  "Not tested",
  "Passed",
  "Retest passed",
  "Failed",
  "Blocked",
  "Needs retest",
  "In progress",
  "Code-verified (encryption at rest); live round-trip pending",
  "Code-verified (restore script); live cross-focus visibility pending",
  "Code-verified (strong); live log capture pending",
  "Code-verified; live launch pending",
  "Code-verified; live listing pending",
  "Code-verified; live nav click pending",
  "Code-verified; live Ollama list pending",
  "Code-verified; live pending",
  "Code-verified; live submenu click pending",
  "Needs retest (live GUI pending)",
  "Needs retest (live GUI/LLM pending)",
  "Not independently verified (hosted; out of local-first scope)",
  "Not independently verified (no live OpenAI key)",
  "Waived by owner",
  "Partial - code + artifact; live boot pending",
  "Partial - code + BUILT-ARTIFACT verified; live OS prompt pending",
  "Partial - code-verified; live dropdown click pending",
  "Partial - code-verified; live LLM extraction pending",
]);

function unzipText(path: string): string {
  return execFileSync("unzip", ["-p", workbookPath, path], { encoding: "utf8" });
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

describe("King's Press feature tracker integrity", () => {
  it("keeps Feature Status test status cells constrained to status labels", () => {
    expect(existsSync(workbookPath)).toBe(true);
    const strings = sharedStrings();
    const cells = sheetCells(unzipText("xl/worksheets/sheet1.xml"), strings);

    const header = cells.get("I1");
    expect(header).toBe("Test Status");

    const invalid: Array<{ row: number; storyId: string; status: string }> = [];
    for (let row = 2; row <= 120; row += 1) {
      const storyId = cells.get(`A${row}`)?.trim();
      if (!storyId) continue;
      const status = cells.get(`I${row}`)?.trim() ?? "";
      if (!allowedStatuses.has(status)) invalid.push({ row, storyId, status });
    }

    expect(invalid).toEqual([]);
  });
});
