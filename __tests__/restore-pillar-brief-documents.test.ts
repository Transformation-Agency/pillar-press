import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restorePillarBriefDocuments } from "../scripts/restore-pillar-brief-documents";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-restore-"));
  tempDirs.push(dir);
  return dir;
}

function createSource(path: string): void {
  const db = new Database(path);
  try {
    db.exec(`
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'Note',
        visibility TEXT NOT NULL DEFAULT 'private',
        status TEXT NOT NULL DEFAULT 'active',
        tags TEXT NOT NULL DEFAULT '[]',
        body TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO knowledge_documents (
        id, title, type, visibility, status, tags, body, word_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "doc-1",
      "Daily Brief",
      "Brief",
      "private",
      "active",
      JSON.stringify(["daily"]),
      "# Daily Brief\n\nBody text.",
      4,
      "2026-06-18T14:00:00.000Z",
      "2026-06-18T14:10:00.000Z",
    );
  } finally {
    db.close();
  }
}

function createTarget(path: string): void {
  const db = new Database(path);
  try {
    db.exec(readFileSync("db/local-sqlite-schema.sql", "utf8"));
  } finally {
    db.close();
  }
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("restorePillarBriefDocuments", () => {
  it("imports Pillar Brief documents as idempotent King’s Press archive pieces", () => {
    const dir = makeTempDir();
    const sourcePath = join(dir, "pillar-brief.sqlite");
    const targetPath = join(dir, "kings-press.sqlite3");
    createSource(sourcePath);
    createTarget(targetPath);

    const first = restorePillarBriefDocuments({ sourcePath, targetPath, backup: false });
    const second = restorePillarBriefDocuments({ sourcePath, targetPath, backup: false });

    expect(first).toMatchObject({ scanned: 1, imported: 1, skipped: 0, campaignId: "pillar-brief-archive" });
    expect(second).toMatchObject({ scanned: 1, imported: 0, skipped: 1, campaignId: "pillar-brief-archive" });

    const db = new Database(targetPath, { readonly: true });
    try {
      const campaign = db.prepare("SELECT id, name FROM campaigns WHERE id = ?").get("pillar-brief-archive") as any;
      const pieces = db.prepare("SELECT id, title, user_id, original, category_context_json FROM pieces").all() as any[];
      expect(campaign).toEqual({ id: "pillar-brief-archive", name: "Pillar Brief Archive" });
      expect(pieces).toHaveLength(1);
      expect(pieces[0].id).toBe("pillar-brief-doc-1");
      expect(pieces[0].user_id).toBe("local-owner");
      expect(pieces[0].original).toContain("Body text.");
      expect(JSON.parse(pieces[0].category_context_json).restoredFrom.sourceDocumentId).toBe("doc-1");
    } finally {
      db.close();
    }
  });
});
