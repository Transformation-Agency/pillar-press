/** Zod schemas for the Gather routes. */
import { z } from "zod";

export const kindSchema = z.enum(["rss", "web", "database", "journal", "x", "youtube"]);

export const createSourceSchema = z.object({
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
});

export const runSchema = z.object({ campaignId: z.string().min(1) });
