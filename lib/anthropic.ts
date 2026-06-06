/**
 * Anthropic client — SERVER ONLY.
 *
 * Server-side replacement for the prototype's window.claude.complete (see
 * prototype-reference/ai.js). All AI calls in Pillar Press go through this
 * module. The API key (ANTHROPIC_API_KEY) is read from the server runtime and
 * is NEVER exposed to the client.
 *
 * Parity with the prototype:
 *  - Model "claude-haiku-4-5".
 *  - complete()/text()/json() mirror ai.js#raw/#text/#json, including the
 *    system -> user/assistant preamble shaping and the JSON repair retry that
 *    re-asks for concise valid JSON.
 *  - extractJSON()/repairJSON() are ported VERBATIM from ai.js (code-fence
 *    stripping, balanced-brace scan, closeBalanced, progressive trailing-field
 *    drop up to 60 iterations).
 *
 * The lib functions in lib/*.ts depend on the AI interface shape
 * ({ json, text, extractJSON, repairJSON }) so they can be unit-tested with a
 * fake AI and without a database or network.
 */

import Anthropic from "@anthropic-ai/sdk";

// Parity with the prototype. Kept here as a single source of truth.
export const MODEL = "claude-haiku-4-5";
// Output-token ceiling. 32000 requires streaming (which raw() uses) — the
// non-streaming path caps long generations at the 10-minute request limit.
// You're billed for tokens actually generated, not this ceiling, so a high value
// only removes truncation risk for single-pass outputs (references edit, voice
// script, large gate/output JSON). Revision/weave still chunk for fidelity.
export const MAX_TOKENS = 32000;

export class AnthropicError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "AnthropicError";
  }
}

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIOptions {
  system?: string;
}

// The interface the pure lib functions take, so they can be tested with a fake.
export interface AI {
  complete(messages: AIMessage[], system?: string): Promise<string>;
  json<T = unknown>(prompt: string, opts?: AIOptions): Promise<T>;
  text(prompt: string, opts?: AIOptions): Promise<string>;
  extractJSON<T = unknown>(text: string): T | null;
  repairJSON<T = unknown>(text: string): T | null;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new AnthropicError(500, "config", "Missing ANTHROPIC_API_KEY in server environment.");
  _client = new Anthropic({ apiKey: k });
  return _client;
}

/* ------------------------------------------------------------------ *
 * JSON extraction / repair — ported VERBATIM from prototype-reference/ai.js
 * ------------------------------------------------------------------ */

export function extractJSON<T = unknown>(text: string): T | null {
  if (!text) return null;
  // strip code fences
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // direct parse
  try { return JSON.parse(t); } catch (e) {}
  // find first balanced { ... } or [ ... ]
  const start = t.search(/[{\[]/);
  if (start === -1) return null;
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try { return JSON.parse(slice); } catch (e) { return null; }
      } }
    }
  }
  return null;
}

// Attempt to recover a usable object from TRUNCATED JSON by closing
// open strings/brackets, then progressively dropping trailing fields.
function closeBalanced<T = unknown>(s: string): T | null {
  const stack: string[] = []; let inStr = false, esc = false, out = "";
  for (const c of s) {
    out += c;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else { if (c === '"') inStr = true; else if (c === "{") stack.push("}"); else if (c === "[") stack.push("]"); else if (c === "}" || c === "]") stack.pop(); }
  }
  if (inStr) out += '"';
  out = out.replace(/[,:]\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  try { return JSON.parse(out); } catch (e) { return null; }
}

export function repairJSON<T = unknown>(text: string): T | null {
  if (!text) return null;
  const start = text.search(/[{\[]/);
  if (start < 0) return null;
  const s = text.slice(start);
  let r = closeBalanced<T>(s);
  if (r) return r;
  let idx = s.length;
  for (let k = 0; k < 60; k++) {
    idx = s.lastIndexOf(",", idx - 1);
    if (idx < 0) break;
    r = closeBalanced<T>(s.slice(0, idx));
    if (r) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Low-level call — mirrors ai.js#raw, including the system -> user/assistant
 * preamble shaping.
 * ------------------------------------------------------------------ */

async function raw(messages: AIMessage[], system?: string): Promise<string> {
  const msgs: AIMessage[] = system
    ? [{ role: "user", content: system },
       { role: "assistant", content: "Understood. I will follow these instructions exactly and reply only in the specified format." },
       ...messages]
    : messages;

  let resp;
  try {
    // Stream so large generations aren't capped by the non-streaming 10-minute
    // request limit; finalMessage() assembles the full message when done.
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: msgs,
    });
    resp = await stream.finalMessage();
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    throw new AnthropicError(e?.status ?? 502, "anthropic", e?.message ?? "Anthropic request failed.", err);
  }

  return resp.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

export async function complete(messages: AIMessage[], system?: string): Promise<string> {
  return raw(messages, system);
}

// Call expecting JSON. Falls back to truncation repair, then a repair round-trip.
export async function json<T = unknown>(prompt: string, { system }: AIOptions = {}): Promise<T> {
  const messages: AIMessage[] = [{ role: "user", content: prompt }];
  let out = await raw(messages, system);
  let parsed = extractJSON<T>(out) || repairJSON<T>(out);
  if (parsed) return parsed;
  // repair attempt
  messages.push({ role: "assistant", content: out });
  messages.push({ role: "user", content: "Return ONLY valid JSON matching the schema. Be concise so it fits. No prose, no code fences." });
  out = await raw(messages, system);
  parsed = extractJSON<T>(out) || repairJSON<T>(out);
  if (parsed) return parsed;
  throw new AnthropicError(502, "parse", "Could not parse JSON from model output.");
}

export async function text(prompt: string, { system }: AIOptions = {}): Promise<string> {
  return raw([{ role: "user", content: prompt }], system);
}

// Default AI implementation backed by the live Anthropic client.
export const ai: AI = { complete, json, text, extractJSON, repairJSON };
