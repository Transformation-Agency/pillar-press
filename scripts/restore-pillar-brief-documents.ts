import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_USER_ID = "local-owner";
const LOCAL_WORKSPACE_ID = "local-workspace";
const ARCHIVE_CAMPAIGN_ID = "pillar-brief-archive";
const ARCHIVE_CAMPAIGN_NAME = "Pillar Brief Archive";

export interface RestoreOptions {
  sourcePath: string;
  targetPath: string;
  backup?: boolean;
  campaignId?: string;
  campaignName?: string;
  userId?: string;
  workspaceId?: string;
}

export interface RestoreResult {
  sourcePath: string;
  targetPath: string;
  backupPath: string | null;
  campaignId: string;
  scanned: number;
  imported: number;
  skipped: number;
}

interface PillarBriefDocument {
  id: string;
  title: string;
  type: string;
  visibility: string;
  status: string;
  tags: string;
  body: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultSourcePath(): string {
  return join(process.env.HOME || "", "Library", "Application Support", "com.pillarbrief.desktop", "pillar-brief.sqlite");
}

function defaultTargetPath(): string {
  return join(process.env.HOME || "", "Library", "Application Support", "com.kingspress.editorialdesk", "kings-press.sqlite3");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function loadSchema(): string {
  return readFileSync(join(repoRoot(), "db", "local-sqlite-schema.sql"), "utf8");
}

function ensureTargetSchema(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(loadSchema());
}

function backupTarget(targetPath: string): string {
  const backupPath = join(
    dirname(targetPath),
    `kings-press.before-pillar-brief-doc-restore-${timestamp()}.sqlite3`,
  );
  mkdirSync(dirname(backupPath), { recursive: true });
  try {
    const db = new Database(targetPath, { readonly: true });
    try {
      db.prepare("VACUUM INTO ?").run(backupPath);
    } finally {
      db.close();
    }
  } catch {
    copyFileSync(targetPath, backupPath);
  }
  return backupPath;
}

function normalizeCreatedAt(value: string | null | undefined): string {
  return value && value.trim() ? value : new Date().toISOString();
}

function pieceIdFor(documentId: string): string {
  return `pillar-brief-${documentId}`;
}

function sourceContextFor(row: PillarBriefDocument): string {
  return JSON.stringify({
    restoredFrom: {
      sourceApp: "Pillar Brief",
      sourceTable: "knowledge_documents",
      sourceDocumentId: row.id,
      type: row.type,
      visibility: row.visibility,
      status: row.status,
      tags: safeJson(row.tags, []),
      wordCount: row.word_count,
    },
  });
}

function safeJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function restorePillarBriefDocuments(options: RestoreOptions): RestoreResult {
  const sourcePath = options.sourcePath;
  const targetPath = options.targetPath;
  const campaignId = options.campaignId || ARCHIVE_CAMPAIGN_ID;
  const campaignName = options.campaignName || ARCHIVE_CAMPAIGN_NAME;
  const userId = options.userId || LOCAL_USER_ID;
  const workspaceId = options.workspaceId || LOCAL_WORKSPACE_ID;

  if (!existsSync(sourcePath)) {
    throw new Error(`Source database not found: ${sourcePath}`);
  }
  if (!existsSync(targetPath)) {
    throw new Error(`Target database not found: ${targetPath}`);
  }

  const backupPath = options.backup === false ? null : backupTarget(targetPath);
  const source = new Database(sourcePath, { readonly: true });
  const target = new Database(targetPath);
  try {
    ensureTargetSchema(target);
    const docs = source
      .prepare("SELECT * FROM knowledge_documents WHERE length(trim(body)) > 0 ORDER BY created_at ASC")
      .all() as PillarBriefDocument[];

    let imported = 0;
    let skipped = 0;
    const tx = target.transaction(() => {
      target.prepare("INSERT OR IGNORE INTO local_users (id, display_name) VALUES (?, ?)").run(userId, "Owner");
      target.prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)").run(workspaceId, "My Workspace");
      target
        .prepare("INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)")
        .run("local-membership", workspaceId, userId, "author");
      target
        .prepare(
          `INSERT OR IGNORE INTO campaigns (id, workspace_id, slug, name, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .run(campaignId, workspaceId, "pillar-brief-archive", campaignName);
      target
        .prepare(
          `INSERT OR IGNORE INTO references_doc (id, campaign_id, doc_json, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        )
        .run("refs-pillar-brief-archive", campaignId, "{}",);

      const exists = target.prepare("SELECT id FROM pieces WHERE id = ?");
      const insert = target.prepare(
        `INSERT INTO pieces (
          id, campaign_id, user_id, title, status, original, category,
          category_context_json, gate_notes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'Draft', ?, 'article', ?, '{}', ?, ?)`,
      );
      for (const doc of docs) {
        const pieceId = pieceIdFor(doc.id);
        if (exists.get(pieceId)) {
          skipped += 1;
          continue;
        }
        insert.run(
          pieceId,
          campaignId,
          userId,
          doc.title,
          doc.body,
          sourceContextFor(doc),
          normalizeCreatedAt(doc.created_at),
          normalizeCreatedAt(doc.updated_at),
        );
        imported += 1;
      }
    });
    tx();
    return {
      sourcePath,
      targetPath,
      backupPath,
      campaignId,
      scanned: docs.length,
      imported,
      skipped,
    };
  } finally {
    source.close();
    target.close();
  }
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sourcePath = argValue("--source") || defaultSourcePath();
  const targetPath = argValue("--target") || defaultTargetPath();
  const noBackup = process.argv.includes("--no-backup");
  const result = restorePillarBriefDocuments({
    sourcePath,
    targetPath,
    backup: !noBackup,
  });
  console.log(JSON.stringify(result, null, 2));
}
