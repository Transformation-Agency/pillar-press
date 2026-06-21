/**
 * Zod schemas for the Pieces routes (Unit U2.2).
 *
 * Kept in this unit-local file (NOT the shared lib/validation.ts) per the build
 * conventions. Mirrors the piece shape in DATA_MODEL.md / prototype store.js.
 */
import { z } from "zod";
import { pieceCategory, pieceStatus } from "@/db/schema";

const categoryContextSchema = z.record(z.string(), z.unknown());

/** POST /api/campaigns/:cid/pieces — create a piece (status defaults to Draft). */
export const createPieceSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Title is required.").max(300),
  original: z.string().max(200_000).optional(),
  category: z.enum(pieceCategory).optional().default("article"),
  categoryContext: categoryContextSchema.optional().default({}),
});
export type CreatePieceInput = z.infer<typeof createPieceSchema>;

export const GATE_IDS = ["strategy", "audience", "tone", "rigor", "stress", "clarity", "self"] as const;

/** PATCH /api/pieces/:id — update title / original / status / author guidance. */
export const updatePieceSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    original: z.string().max(200_000).optional(),
    status: z.enum(pieceStatus).optional(),
    category: z.enum(pieceCategory).optional(),
    categoryContext: categoryContextSchema.optional(),
    direction: z.string().max(4000).optional(),
    // per-gate commentary; keys must be valid gate ids. Shallow-merged server-side.
    gateNotes: z.record(z.enum(GATE_IDS), z.string().max(2000)).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined || v.original !== undefined || v.status !== undefined ||
      v.category !== undefined || v.categoryContext !== undefined ||
      v.direction !== undefined || v.gateNotes !== undefined,
    { message: "Provide at least one updatable field." },
  );
export type UpdatePieceInput = z.infer<typeof updatePieceSchema>;
