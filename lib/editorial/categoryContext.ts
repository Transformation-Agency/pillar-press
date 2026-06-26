export type DeskCategory = "article" | "letter" | "book" | "other";

export interface CategoryContext {
  category: DeskCategory;
  label: string;
  promptBlock: string;
  traceLabel: string;
  revisionModeDefaults?: {
    allowStructuralPass: boolean;
    preserveStructureBias: "high" | "medium" | "low";
  };
}

const CATEGORIES: DeskCategory[] = ["article", "letter", "book", "other"];
const SECRET_RE = /(api[_-]?key|token|secret|password|credential|authorization)/i;

function normalizeCategory(value: unknown): DeskCategory {
  return CATEGORIES.includes(value as DeskCategory) ? (value as DeskCategory) : "article";
}

function cleanString(value: unknown, max = 700): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function readPath(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  let cur: any = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function line(label: string, value: unknown, max?: number): string | null {
  if (SECRET_RE.test(label)) return null;
  const text = cleanString(value, max);
  return text ? `- ${label}: ${text}` : null;
}

function compactJson(value: unknown, max = 900): string {
  if (!value || typeof value !== "object") return "";
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_RE.test(key)) continue;
    if (typeof val === "string") safe[key] = cleanString(val, 240);
    else if (typeof val === "number" || typeof val === "boolean") safe[key] = val;
    else if (Array.isArray(val)) safe[key] = val.slice(0, 6).map((item) => cleanString(item, 120) || item).filter(Boolean);
  }
  const text = JSON.stringify(safe);
  return text === "{}" ? "" : text.slice(0, max);
}

export function buildCategoryContext(piece: {
  category?: unknown;
  categoryContext?: unknown;
  category_context?: unknown;
  title?: string | null;
}): CategoryContext {
  const category = normalizeCategory(piece.category);
  const ctx = (piece.categoryContext ?? piece.category_context ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  let label = "Article review";
  let traceLabel = "Article";
  let preserveStructureBias: "high" | "medium" | "low" = "medium";

  if (category === "letter") {
    const recipientName = cleanString(ctx.recipientName ?? readPath(ctx, ["recipientSnapshot", "displayName"]), 160);
    label = recipientName ? `Letter review for ${recipientName}` : "Letter review";
    traceLabel = recipientName ? `Letter: ${recipientName}` : "Letter";
    preserveStructureBias = "high";
    lines.push("Category lens: Letter / direct communication.");
    [
      line("Recipient", recipientName, 160),
      line("Relationship notes", ctx.relationshipNotes ?? readPath(ctx, ["recipientSnapshot", "relationship"])),
      line("Tone guidance", ctx.toneGuidance ?? ctx.tone ?? readPath(ctx, ["recipientSnapshot", "defaultTone"])),
      line("Structure guidance", ctx.structureGuidance),
      line("Desired outcome", ctx.desiredOutcome),
      line("Occasion", ctx.occasion),
      line("Constraints", ctx.constraints),
    ].forEach((entry) => entry && lines.push(entry));
    lines.push("- Editorial lens: preserve kindness, directness, repair/ask clarity, and do-not-send safety.");
  } else if (category === "book") {
    label = "Book chapter review";
    traceLabel = "Book chapter";
    preserveStructureBias = "high";
    lines.push("Category lens: Book chapter.");
    [
      line("Book", ctx.bookTitle ?? ctx.bookId, 220),
      line("Chapter number", ctx.chapterNumber, 80),
      line("Chapter role", ctx.chapterRole, 500),
      line("Continuity digest", ctx.continuityDigest, 900),
    ].forEach((entry) => entry && lines.push(entry));
    lines.push("- Editorial lens: protect chapter voice and role, note continuity gaps, and never invent missing facts.");
  } else if (category === "other") {
    label = "Communication review";
    traceLabel = "Communication";
    lines.push("Category lens: Other communication.");
    [
      line("Communication goal", ctx.communicationGoal ?? ctx.goal),
      line("Audience", ctx.audience),
      line("Constraints", ctx.constraints),
      line("Call to action", ctx.callToAction),
    ].forEach((entry) => entry && lines.push(entry));
    lines.push("- Editorial lens: goal fit, audience usefulness, constraints, and clear next action.");
  } else {
    lines.push("Category lens: Article / publication.");
    [
      line("Publication goal", ctx.publicationGoal ?? ctx.goal),
      line("Target platform", ctx.targetPlatform),
      line("Audience", ctx.audienceId ?? ctx.audience),
      line("Editorial fit", ctx.editorialFit),
    ].forEach((entry) => entry && lines.push(entry));
    lines.push("- Editorial lens: publication quality, audience fit, platform readiness, clarity, claims, and throughline.");
  }

  const extra = compactJson(ctx);
  if (extra) lines.push(`- Safe context snapshot: ${extra}`);

  return {
    category,
    label,
    traceLabel,
    promptBlock: lines.join("\n"),
    revisionModeDefaults: {
      allowStructuralPass: category !== "letter" || cleanString(ctx.structureGuidance).length > 0,
      preserveStructureBias,
    },
  };
}

export function withCategoryPrompt(refCtx: string, categoryCtx: CategoryContext): string {
  return `${refCtx}

DESK WORKFLOW CONTEXT:
${categoryCtx.promptBlock}

Apply this context as the editorial lens for this pass.`;
}
