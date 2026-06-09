import { ai, extractJSON, repairJSON, type AI } from "@/lib/llm";

export interface ImagePromptInput {
  /** The author's seed (typed text, or the output's media recommendation). */
  seed: string;
  /** The campaign's evolving style directive (palette/mood/finish/detail). */
  styleDirective?: string;
  /** Serialized brand/strategy context (buildRefContext). */
  refContext?: string;
  /** The article this image accompanies, for topical grounding. */
  article?: { title?: string; excerpt?: string };
}

const SYSTEM = `You are an award-winning art director and editorial photographer. Given an article and a seed idea, you write ONE image-generation prompt that yields a striking, gallery-quality cover image — the kind a great magazine would run. The prompt must be specific and confident, never generic.

Your prompt MUST specify, woven into natural prose (not a bulleted list):
- SUBJECT & SCENE: one clear, evocative focal subject in a concrete setting. Translate the article's core idea into a fresh visual METAPHOR or scene — physical, tangible, human-scaled — not a literal illustration of the topic.
- COMPOSITION: framing, vantage, focal point, depth, and deliberate negative space.
- LIGHT: direction, quality, time of day, contrast (e.g. raking low sun, soft north-window light, single hard key).
- MEDIUM & LENS: the rendering (e.g. 85mm large-format photograph, matte oil painting, risograph, cinematic still) and its texture/grain.
- COLOR & MOOD: a disciplined palette and the feeling it carries.

HARD RULES:
- Honor the brand context and the campaign STYLE DIRECTIVE (palette/mood/finish/detail) below — they govern the look.
- NO text, words, letters, numbers, logos, watermarks, charts, diagrams, UI, or screens in the image.
- AVOID clichés: no lightbulbs for ideas, no glowing brains/robots for AI, no handshakes, no gears, no generic stock business imagery, no literal depictions.
- One single coherent concept. 55–95 words. Present tense, descriptive, no preamble.

Return ONLY JSON: {"prompt":"<the image prompt>"}`;

/** Turn a seed + article + brand/style into a vivid, art-directed image prompt. */
export async function craftImagePrompt(input: ImagePromptInput, client: AI = ai): Promise<string> {
  const parts: string[] = [];
  if (input.refContext) parts.push(`BRAND CONTEXT:\n${input.refContext}`);
  if (input.styleDirective) parts.push(`CAMPAIGN STYLE DIRECTIVE (the look to honor):\n${input.styleDirective}`);
  if (input.article?.title) parts.push(`ARTICLE TITLE: ${input.article.title}`);
  if (input.article?.excerpt) parts.push(`ARTICLE EXCERPT:\n${input.article.excerpt}`);
  parts.push(`SEED IDEA / DIRECTION FROM THE AUTHOR: ${input.seed || "(none — invent the strongest cover image for this article)"}`);
  parts.push(`Write the single best cover-image prompt now. Return the JSON.`);

  const out = await client.complete([{ role: "user", content: parts.join("\n\n") }], SYSTEM);
  const parsed = extractJSON<{ prompt?: string }>(out) ?? repairJSON<{ prompt?: string }>(out);
  const prompt = (parsed?.prompt || "").trim();
  // Fall back to the seed if the model returned nothing usable.
  return prompt || input.seed || "";
}
