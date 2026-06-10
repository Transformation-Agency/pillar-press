import { ai, type AI } from "@/lib/llm";

/**
 * Tighten a finished platform post to ~(1 - ratio) of its length, preserving the
 * core claim, the author's voice/register, the hook, and the strongest line.
 * Returns plain text via a delimiter (not JSON) so a long post can't break
 * parsing. Mirrors prototype-reference/generators.js#condenseOutput.
 *
 * Pure + DB-free (the route does auth/persist); `client` is injectable for tests.
 */
export async function condensePost(
  post: string,
  refContext: string,
  ratio = 0.4,
  client: AI = ai,
): Promise<string> {
  const keepPct = Math.round((1 - ratio) * 100);
  const words = post.trim().split(/\s+/).filter(Boolean).length;
  const target = Math.max(15, Math.round(words * (1 - ratio)));
  const system = `You tighten a finished platform post for an author. Cut it to about ${keepPct}% of its current length (roughly ${target} words) by removing redundancy, filler, hedging, and the weakest lines. PRESERVE the core claim, the author's voice and register, the hook, and the single strongest line. Do NOT add new ideas or a new CTA. Keep paragraph breaks where they still earn their place.

AUTHOR REFERENCES:
${refContext}

Return EXACTLY this and nothing else:
@@POST@@
<the condensed post>
@@END@@`;
  const prompt = `ORIGINAL POST (${words} words):\n"""${post}"""\n\nReturn the condensed version now.`;
  const out = await client.complete([{ role: "user", content: prompt }], system);
  let body = out;
  const parts = out.split(/@@\s*POST\s*@@/i);
  if (parts.length > 1) body = parts[1].split(/@@\s*END\s*@@/i)[0];
  return body.replace(/@@\s*END\s*@@[\s\S]*$/i, "").trim() || post;
}
