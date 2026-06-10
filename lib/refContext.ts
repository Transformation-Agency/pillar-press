/**
 * refContext — VERBATIM port of prototype-reference/ai.js#refContext().
 *
 * Builds a compact reference-context block that the gates/generators read.
 * The output of buildRefContext MUST be BYTE-IDENTICAL to what ai.js produces
 * for the same references document (THROUGHLINES / Strategy note / AUDIENCES /
 * REGISTERS / CLARITY RULES / RED LINES / SELF-VISION / GATE PREFERENCES blocks, in this exact
 * order, with the same punctuation, prefixes, and leading "\n" separators).
 * King's Press may append an APPROVED SETUP PROFILE block when onboarding has
 * saved one; ordinary reference documents remain byte-identical to the
 * prototype output.
 *
 * The shape mirrors the references `doc` (see DATA_MODEL.md / SEED_REFERENCES
 * in lib/seed.ts). Every field is optional because the prototype guards each
 * block and each list with `|| []` / truthiness checks.
 */

export interface RefThroughline {
  tag: string;
  name: string;
  note: string;
}

export interface RefListItem {
  id: string;
  name: string;
  note: string;
}

export interface ReferencesDoc {
  strategy?: {
    throughlines?: readonly RefThroughline[];
    body?: string;
  };
  audiences?: {
    list?: readonly RefListItem[];
  };
  registers?: {
    list?: readonly RefListItem[];
    body?: string;
  };
  voiceRules?: {
    rules?: readonly string[];
  };
  redLines?: {
    rules?: readonly string[];
  };
  selfVision?: {
    body?: string;
  };
  gateSpec?: {
    body?: string;
  };
  setupProfile?: {
    profile?: unknown;
  };
  [key: string]: unknown;
}

function cleanSetupText(value: unknown, maxLength = 360): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function setupStringList(value: unknown, maxItems = 5): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanSetupText(item, 120)).filter(Boolean).slice(0, maxItems)
    : [];
}

function buildSetupProfileBlock(profile: unknown): string[] {
  if (!profile || typeof profile !== "object") return [];
  const p = profile as Record<string, any>;
  const voice = p.voiceProfile && typeof p.voiceProfile === "object" ? p.voiceProfile : {};
  const publication = p.publicationDefaults && typeof p.publicationDefaults === "object" ? p.publicationDefaults : {};
  const permissions = p.permissions && typeof p.permissions === "object" ? p.permissions : {};
  const lines = ["\nAPPROVED SETUP PROFILE:"];

  const selfStatement = cleanSetupText(p.selfStatement || voice.userDescription);
  if (selfStatement) lines.push("Self statement: " + selfStatement);

  const platforms = Array.isArray(p.communicationPlatforms)
    ? p.communicationPlatforms
        .map((item: any) => cleanSetupText(item && (item.platform || item.name || item), 80))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  if (platforms.length) lines.push("Communication platforms: " + platforms.join(", "));

  const outputTypes = setupStringList(publication.defaultOutputTypes, 8);
  if (outputTypes.length) lines.push("Writing formats: " + outputTypes.join(", "));

  const toneWords = setupStringList(voice.toneWords, 8);
  if (toneWords.length) lines.push("Tone words: " + toneWords.join(", "));

  const avoid = setupStringList(voice.avoid, 8);
  if (avoid.length) lines.push("Avoid: " + avoid.join(", "));

  const preservation = cleanSetupText(publication.preserveRawLanguage, 80);
  if (preservation) lines.push("Preservation preference: " + preservation);

  lines.push(
    "Permissions: memory=" + (permissions.mayUseSavedMemory ? "approved" : "not approved") +
      "; examples=" + (permissions.mayUseUploadedVoiceExamples ? "approved" : "not approved") +
      "; web=" + (permissions.mayUseWebResearch ? "approved" : "not approved") +
      "; publish/send=not approved",
  );

  return lines;
}

/**
 * Port of ai.js `refContext(refs)`. Takes the references doc directly (the
 * server has no window.Store fallback) and returns the prompt-context string.
 */
export function buildRefContext(references?: ReferencesDoc | null): string {
  const r: ReferencesDoc = references || {};
  const lines: string[] = [];
  if (r.strategy) {
    lines.push("THROUGHLINES:");
    (r.strategy.throughlines || []).forEach((t) =>
      lines.push(`- [${t.tag}] ${t.name}: ${t.note}`),
    );
    if (r.strategy.body) lines.push("Strategy note: " + r.strategy.body);
  }
  if (r.audiences) {
    lines.push("\nAUDIENCES:");
    (r.audiences.list || []).forEach((a) =>
      lines.push(`- [${a.id}] ${a.name}: ${a.note}`),
    );
  }
  if (r.registers) {
    lines.push("\nREGISTERS:");
    (r.registers.list || []).forEach((x) =>
      lines.push(`- [${x.id}] ${x.name}: ${x.note}`),
    );
    if (r.registers.body) lines.push(r.registers.body);
  }
  if (r.voiceRules) {
    lines.push("\nCLARITY RULES:");
    (r.voiceRules.rules || []).forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  }
  if (r.redLines) {
    lines.push("\nRED LINES:");
    (r.redLines.rules || []).forEach((x) => lines.push(`- ${x}`));
  }
  if (r.selfVision && r.selfVision.body) {
    lines.push("\nSELF-VISION (public identity):\n" + r.selfVision.body);
  }
  if (r.gateSpec && r.gateSpec.body) {
    lines.push("\nGATE PREFERENCES:\n" + r.gateSpec.body);
  }
  if (r.setupProfile && r.setupProfile.profile) {
    lines.push(...buildSetupProfileBlock(r.setupProfile.profile));
  }
  return lines.join("\n");
}
