import { z } from "zod";

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|credential|refresh[_-]?token|access[_-]?token|oauth|smtp)/i;

function rejectSecretKeys(value: unknown, ctx: z.RefinementCtx, path: (string | number)[] = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretKeys(item, ctx, path.concat(index)));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider keys, tokens, passwords, and delivery credentials cannot be stored here.",
        path: path.concat(key),
      });
    }
    rejectSecretKeys(nested, ctx, path.concat(key));
  }
}

const jsonObjectNoSecrets = z.record(z.string(), z.unknown()).default({}).superRefine((value, ctx) => {
  rejectSecretKeys(value, ctx);
  const serialized = JSON.stringify(value);
  if (serialized.length > 80_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: 80_000,
      type: "string",
      inclusive: true,
      message: "JSON guidance is too large.",
    });
  }
});

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const letterUploadSchema = z.object({
  name: z.string().trim().min(1).max(300),
  text: z.string().max(80_000).optional().nullable(),
  size: z.number().int().nonnegative().max(20_000_000).optional().nullable(),
  mimeType: z.string().trim().max(200).optional().nullable(),
}).superRefine((value, ctx) => rejectSecretKeys(value, ctx));

export const recipientCreateSchema = z.object({
  id: z.string().uuid().optional(),
  displayName: z.string().trim().min(1, "Display name is required.").max(200),
  sortName: optionalText(200),
  organization: optionalText(300),
  role: optionalText(200),
  relationship: optionalText(1000),
  defaultSalutation: optionalText(300),
  defaultSignoff: optionalText(300),
  defaultTone: optionalText(1000),
  notes: optionalText(20_000),
  preferences: jsonObjectNoSecrets.optional().default({}),
});
export type RecipientCreateInput = z.infer<typeof recipientCreateSchema>;

export const recipientUpdateSchema = recipientCreateSchema
  .omit({ id: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one updatable field." });
export type RecipientUpdateInput = z.infer<typeof recipientUpdateSchema>;

export const letterWorkflowCreateSchema = z.object({
  id: z.string().uuid().optional(),
  campaignId: z.string().min(1).max(120),
  pieceId: z.string().min(1).max(120).optional().nullable(),
  recipientId: z.string().min(1).max(120).optional().nullable(),
  recipientSnapshot: jsonObjectNoSecrets.optional().default({}),
  purpose: z.string().trim().max(80_000).optional().default(""),
  desiredOutcome: optionalText(80_000),
  occasion: optionalText(2000),
  tone: optionalText(4000),
  constraints: optionalText(20_000),
  sourceContext: optionalText(80_000),
  uploads: z.array(letterUploadSchema).max(20).optional().default([]),
  dictationTranscript: optionalText(80_000),
  status: z.string().trim().max(60).optional().default("draft"),
});
export type LetterWorkflowCreateInput = z.infer<typeof letterWorkflowCreateSchema>;

export const letterWorkflowUpdateSchema = letterWorkflowCreateSchema
  .omit({ id: true, campaignId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one updatable field." });
export type LetterWorkflowUpdateInput = z.infer<typeof letterWorkflowUpdateSchema>;

export const letterDraftSchema = z.object({
  refreshPiece: z.boolean().optional().default(true),
});
export type LetterDraftInput = z.infer<typeof letterDraftSchema>;
