/** Zod schemas for the Gather routes. */
import { z } from "zod";

export const kindSchema = z.enum(["rss", "web", "database", "journal", "x", "youtube"]);

/** Human labels for each connector kind (server-side; mirrors gather.js SOURCE_KINDS). */
export const SOURCE_KIND_LABELS: Record<string, string> = {
  rss: "RSS / News feed",
  web: "Web search",
  database: "Database scrape",
  journal: "Journal library",
  x: "X trending",
  youtube: "YouTube transcript",
};

export const createSourceSchema = z.object({
  // Honor a client-generated id so later PATCH/DELETE target the same row
  // (mirrors campaigns/pieces). Without this the server would mint a different
  // uuid and the client's updates would 404.
  id: z.string().uuid().optional(),
  campaignId: z.string().min(1),
  kind: kindSchema,
  config: z.string().trim().max(500).default(""),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean().default(true),
});

export const updateSourceSchema = z.object({
  config: z.string().trim().max(500).optional(),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
  // Clearing the persisted brief (dismiss / sent to Weave). Pass null to clear.
  summary: z.string().nullable().optional(),
});

export const runSchema = z.object({ campaignId: z.string().min(1) });

// Items can also be uploaded documents (kind "upload"), not just fetched.
export const itemKindSchema = z.enum(["rss", "web", "database", "journal", "x", "youtube", "upload"]);

export const createItemSchema = z.object({
  id: z.string().uuid().optional(),
  campaignId: z.string().min(1),
  kind: itemKindSchema,
  title: z.string().trim().min(1).max(300),
  source: z.string().trim().max(200).optional(),
  author: z.string().trim().max(200).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  snippet: z.string().max(2000).optional(),
  transcript: z.string().nullable().optional(),
});
