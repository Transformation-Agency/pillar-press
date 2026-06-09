import { ai, extractJSON, repairJSON, type AI } from "@/lib/llm";
import type { StyleKnobs } from "@/db/style-schema";
import { DEFAULT_KNOBS } from "@/db/style-schema";

// Allowed knob values (validate incoming feedback against these).
export const KNOB_OPTIONS = {
  palette: ["warm", "cool", "muted", "vivid", "mono"],
  mood: ["bright", "neutral", "moody"],
  finish: ["photographic", "illustrated", "painterly", "graphic"],
  detail: ["minimal", "balanced", "detailed"],
} as const;

/** Coerce arbitrary knobs to valid values, falling back to the defaults. */
export function normalizeKnobs(k: Partial<Record<keyof StyleKnobs, string>> | undefined | null): StyleKnobs {
  const pick = <K extends keyof typeof KNOB_OPTIONS>(key: K): StyleKnobs[K] => {
    const v = k?.[key] as string | undefined;
    return ((KNOB_OPTIONS[key] as readonly string[]).includes(v ?? "") ? v : DEFAULT_KNOBS[key]) as StyleKnobs[K];
  };
  return { palette: pick("palette"), mood: pick("mood"), finish: pick("finish"), detail: pick("detail") };
}

export interface StyleSurvey {
  rating: number;
  knobs: StyleKnobs;
  working?: string;
  notes?: string;
}

function parseJsonTolerant<T = { directive?: string }>(out: string): T | null {
  return extractJSON<T>(out) ?? repairJSON<T>(out);
}

/** Synthesize the updated cumulative style directive from prior + new feedback.
 *  Chosen knobs are saved directly by the caller; the model only writes prose. */
export async function refineStyleDirective(
  prior: { directive?: string } | null,
  survey: StyleSurvey,
  refContext: string,
  client: AI = ai,
): Promise<string> {
  const system = `You maintain an EVOLVING image-style profile for an author's brand. You are given the prior style directive and the author's feedback on the latest generation. Produce an updated, CUMULATIVE style directive (2-4 sentences) that captures their developing visual taste — it will be prepended to future image prompts. Keep what's still wanted, fold in the new feedback, resolve conflicts toward the newest signal. Be concrete about palette, mood, lighting, finish, composition. Do not exceed 60 words.

AUTHOR BRAND CONTEXT:
${refContext}

Return ONLY JSON: {"directive":"<the updated style directive>"}`;
  const prompt = `PRIOR DIRECTIVE: ${prior?.directive || "(none yet)"}

LATEST OUTPUT RATING: ${survey.rating}/5
CHOSEN KNOBS: palette=${survey.knobs.palette}, mood=${survey.knobs.mood}, finish=${survey.knobs.finish}, detail=${survey.knobs.detail}
WHAT'S WORKING: ${survey.working || "(none)"}
WHAT'S OFF / WANT MORE OF: ${survey.notes || "(none)"}

Return the JSON.`;
  const out = await client.complete([{ role: "user", content: prompt }], system);
  const parsed = parseJsonTolerant(out);
  return parsed?.directive || prior?.directive || "";
}
