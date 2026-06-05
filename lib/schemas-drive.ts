/**
 * Zod schemas for the Google Drive export routes (Unit U4.2).
 *
 * Only the upload body needs validation. The auth + callback routes take query
 * params (validated inline in the handler) and the status route takes none.
 */
import { z } from "zod";

/**
 * POST /api/drive/upload body.
 *   - scope:'one'  → upload a single platform output (`platform` required)
 *   - scope:'all'  → upload the combined "all outputs" markdown document
 */
export const driveUploadSchema = z
  .object({
    pieceId: z.string().uuid(),
    scope: z.enum(["one", "all"]),
    platform: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((b) => b.scope !== "one" || !!b.platform, {
    message: "platform is required when scope is 'one'.",
    path: ["platform"],
  });

export type DriveUploadInput = z.infer<typeof driveUploadSchema>;

/**
 * POST /api/drive/upload body — prebuilt-files mode.
 *   { files: [{ name, content, mime? }] } → upload the given files as-is to the
 *   linked Drive folder. Used by the front-end's export path which builds the
 *   file contents client-side.
 */
export const driveUploadFilesSchema = z
  .object({
    files: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          content: z.string().max(5_000_000),
          mime: z.string().min(1).max(255).optional(),
        }),
      )
      .min(1, "Provide at least one file."),
  })
  .strict();

export type DriveUploadFilesInput = z.infer<typeof driveUploadFilesSchema>;
