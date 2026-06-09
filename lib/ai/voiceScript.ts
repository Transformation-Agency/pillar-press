import { ai, type AI } from "@/lib/llm";

export interface VoiceScriptInput {
  /** The article to voice: title + full body text. */
  article: { title?: string; text: string };
  /** Serialized brand/voice context (buildRefContext), for tone fidelity. */
  refContext?: string;
  /** The chosen ElevenLabs voice's name/persona, to lightly tune delivery. */
  voiceName?: string;
}

const SYSTEM = `You are a voiceover script editor. You adapt a written article into a clean script for ElevenLabs text-to-speech (Multilingual v2), read aloud by a single narrator in the author's voice.

Rewrite the article as natural SPOKEN narration that preserves its meaning, argument, structure, and voice — lightly smoothing written-only constructions so they land for the ear.

FORMAT RULES (critical for this TTS model):
- Output PLAIN PROSE only. No markdown, headings, bullet points, numbered lists, asterisks, emojis, hashtags, tables, or URLs/links.
- Do NOT include stage directions or bracketed audio tags (e.g. [pause], [laughs], (sighs)) — Multilingual v2 reads them aloud. Convey pacing with punctuation instead: commas and periods for breaths, em dashes for a beat, ellipses for a trailing pause.
- Expand anything a TTS engine mispronounces into spoken words: "%" → "percent", "&" → "and", "$5" → "five dollars", "e.g." → "for example", "i.e." → "that is", "#" → "number"; space or spell out acronyms that should be read as letters; and write numerals out as words where that reads more naturally aloud.
- Remove or rephrase purely visual references ("as shown above", "see the chart", figure/table callouts, page-only parentheticals) into something that makes sense when heard — or cut them.
- Keep sentences a comfortable speaking length; split long written sentences into shorter spoken ones.
- Do NOT invent content, facts, or citations. Do NOT add greetings ("Hello and welcome"), sign-offs, or calls to action unless they already exist in the piece. Stay faithful.

Return EXACTLY this and nothing else (no preamble, no JSON):
@@SCRIPT@@
<the spoken script as plain prose; keep paragraph breaks as blank lines>
@@END@@`;

/** Extract the script body from the delimited output (robust for long text). */
export function parseVoiceScript(out: string): string {
  let body = out || "";
  const m = body.split(/@@\s*SCRIPT\s*@@/i);
  if (m.length > 1) body = m[1];
  body = body.replace(/@@\s*END\s*@@[\s\S]*$/i, "");
  return body.trim();
}

/** Turn a linked piece + brand/voice context into an ElevenLabs-ready script. */
export async function craftVoiceScript(input: VoiceScriptInput, client: AI = ai): Promise<string> {
  const text = (input.article?.text || "").trim();
  if (!text) return "";

  const parts: string[] = [];
  if (input.refContext) parts.push(`AUTHOR / BRAND VOICE CONTEXT (for tone fidelity):\n${input.refContext}`);
  if (input.voiceName) parts.push(`NARRATOR VOICE: ${input.voiceName} — lightly suit the delivery to this persona without changing the substance.`);
  if (input.article?.title) parts.push(`ARTICLE TITLE: ${input.article.title}`);
  parts.push(`ARTICLE:\n"""${text}"""`);
  parts.push(`Adapt this into the spoken voiceover script now. Return the delimited format.`);

  const out = await client.text(parts.join("\n\n"), { system: SYSTEM });
  const script = parseVoiceScript(out);
  // Fall back to the raw article text if the model returned nothing usable.
  return script || text;
}
