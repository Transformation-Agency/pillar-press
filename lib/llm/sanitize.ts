const REASONING_BLOCK_PATTERNS = [
  /<think\b[^>]*>[\s\S]*?<\/think>/gi,
  /<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi,
  /<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi,
  /<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi,
];

const LEADING_REASONING_PATTERNS = [
  /^\s*(?:thinking|reasoning|analysis)\s*:\s*[\s\S]*?(?=\n\s*(?:final|answer)\s*:)/i,
  /^\s*(?:final|answer)\s*:\s*/i,
];

export function sanitizeModelOutput(text: string): string {
  let cleaned = text || "";

  for (const pattern of REASONING_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  for (const pattern of LEADING_REASONING_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
