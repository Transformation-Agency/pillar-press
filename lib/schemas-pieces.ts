/**
 * Zod schemas for the Pieces routes (Unit U2.2).
 *
 * Kept in this unit-local file (NOT the shared lib/validation.ts) per the build
 * conventions. Mirrors the piece shape in DATA_MODEL.md / prototype store.js.
 */
import { z } from "zod";
import { pieceStatus } from "@/db/schema";

/** POST /api/campaigns/:cid/pieces — create a piece (status defaults to Draft). */
export const createPieceSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Title is required.").max(300),
  original: z.string().max(200_000).optional(),
});
export type CreatePieceInput = z.infer<typeof createPieceSchema>;

/** PATCH /api/pieces/:id — update title / original / status. */
export const updatePieceSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    original: z.string().max(200_000).optional(),
    status: z.enum(pieceStatus).optional(),
  })
  .refine(
    (v) => v.title !== undefined || v.original !== undefined || v.status !== undefined,
    { message: "Provide at least one of title, original, or status." },
  );
export type UpdatePieceInput = z.infer<typeof updatePieceSchema>;
