import { ai, type AI } from "@/lib/llm";

export interface TitleInput {
  text: string;
  refContext?: string;
}

const SYSTEM = `You are a sharp magazine editor. Given an article (and optional brand-voice context), write ONE title for it: specific, compelling, and true to the piece — the kind that makes the right reader click, without hype or clickbait.

Rules:
- Return ONLY the title text — no quotes, no surrounding punctuation, no markdown, no subtitle, no trailing period, no "Title:" prefix.
- Keep it under ~80 characters.
- Capture the actual thesis or tension of THIS piece, not a generic topic label.
- Match the author's voice if brand context is given.`;

/** Generate a concise editorial title from a piece's text. */
export async function craftTitle(input: TitleInput, client: AI = ai): Promise<string> {
  const text = (input.text || "").trim();
  if (!text) return "";
  const parts: string[] = [];
  if (input.refContext) parts.push(`BRAND VOICE CONTEXT:\n${input.refContext}`);
  parts.push(`ARTICLE:\n"""${text.slice(0, 6000)}"""`);
  parts.push("Write the single best title now. Return only the title.");

  const out = await client.complete([{ role: "user", content: parts.join("\n\n") }], SYSTEM);
  // First non-empty line, strip wrapping quotes and trailing period, cap length.
  let t = (out || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  t = t.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "").replace(/[.\s]+$/, "").trim();
  if (t.length > 120) t = t.slice(0, 120).trim();
  return t;
}
