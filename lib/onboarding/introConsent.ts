export type IntroConsent = "yes" | "no" | "unclear";

const YES_PATTERNS = [
  /\byes\b/i,
  /\byeah\b/i,
  /\byep\b/i,
  /\bsure\b/i,
  /\bokay\b/i,
  /\bok\b/i,
  /\bgo ahead\b/i,
  /\bintroduce yourself\b/i,
  /\btell me\b/i,
];

const NO_PATTERNS = [
  /\bno\b/i,
  /\bskip\b/i,
  /\bnot now\b/i,
  /\blater\b/i,
  /\bdon't\b/i,
  /\bdo not\b/i,
];

export function classifyIntroConsent(transcript: string): IntroConsent {
  const text = transcript.trim();

  if (!text) return "unclear";
  if (NO_PATTERNS.some((pattern) => pattern.test(text))) return "no";
  if (YES_PATTERNS.some((pattern) => pattern.test(text))) return "yes";

  return "unclear";
}
