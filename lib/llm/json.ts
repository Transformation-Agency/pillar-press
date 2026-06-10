/* JSON extraction / repair — shared by every LLM provider. */

export function extractJSON<T = unknown>(text: string): T | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    /* scan for a balanced JSON object/array below */
  }

  const start = t.search(/[{\[]/);
  if (start === -1) return null;
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const slice = t.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function closeBalanced<T = unknown>(s: string): T | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let out = "";
  for (const c of s) {
    out += c;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") stack.pop();
    }
  }
  if (inStr) out += '"';
  out = out.replace(/[,:]\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
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
