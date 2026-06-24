import { describe, expect, it, vi } from "vitest";
import { craftReferencesEdit } from "@/lib/ai/refsEdit";
import type { AI } from "@/lib/llm";
import type { ReferencesDoc } from "@/lib/refContext";

function fakeAI(output: string): AI {
  return {
    complete: vi.fn(async () => output),
    extractJSON: vi.fn(),
    repairJSON: vi.fn(),
    text: vi.fn(),
    json: vi.fn(),
  } as unknown as AI;
}

const baseDoc: ReferencesDoc = {
  strategy: {
    throughlines: [{ tag: "agency", name: "Agency", note: "Keep people acting with agency." }],
    body: "Original strategy note.",
  },
  audiences: { list: [{ id: "builders", name: "Builders", note: "People building useful things." }] },
  registers: {
    list: [{ id: "plain", name: "Plainspoken", note: "Clear, warm, direct." }],
    body: "Use the plain register by default.",
  },
  voiceRules: { rules: ["Use concrete verbs."] },
  redLines: { rules: ["No hype."] },
  selfVision: { body: "A practical editorial desk." },
  gateSpec: { body: "Check clarity and truthfulness." },
};

describe("craftReferencesEdit", () => {
  it("merges changed sections while preserving untouched preferences", async () => {
    const ai = fakeAI(JSON.stringify({
      doc: {
        audiences: {
          list: [
            { id: "builders", name: "Builders", note: "People building useful things." },
            { id: "execs", name: "Skeptical executives", note: "Leaders who need grounded, non-hype framing." },
          ],
        },
      },
      summary: "Added a skeptical-executive audience.",
    }));

    const result = await craftReferencesEdit({
      doc: baseDoc,
      instruction: "Add an audience for skeptical executives.",
    }, ai);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Added a skeptical-executive audience.");
    expect(result.doc.audiences?.list).toHaveLength(2);
    expect(result.doc.strategy).toEqual(baseDoc.strategy);
    expect(result.doc.voiceRules).toEqual(baseDoc.voiceRules);
    expect(ai.complete).toHaveBeenCalledWith(
      [expect.objectContaining({ role: "user", content: expect.stringContaining("Add an audience") })],
      expect.stringContaining("Return ONLY the sections you actually changed"),
    );
  });

  it("accepts bare changed-section JSON and ignores malformed section fields", async () => {
    const ai = fakeAI(JSON.stringify({
      voiceRules: { rules: ["Keep it grounded.", 7, "", "Use concrete verbs."] },
      redLines: { rules: "do not accept non-list values" },
    }));

    const result = await craftReferencesEdit({ doc: baseDoc, instruction: "Tighten voice rules." }, ai);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Updated the references.");
    expect(result.doc.voiceRules?.rules).toEqual(["Keep it grounded.", "Use concrete verbs."]);
    expect(result.doc.redLines).toEqual(baseDoc.redLines);
  });

  it("returns ok false when the model output has no usable reference sections", async () => {
    const result = await craftReferencesEdit(
      { doc: baseDoc, instruction: "Make it warmer." },
      fakeAI("I changed it."),
    );

    expect(result.ok).toBe(false);
    expect(result.doc).toEqual({
      strategy: baseDoc.strategy,
      audiences: baseDoc.audiences,
      registers: baseDoc.registers,
      voiceRules: baseDoc.voiceRules,
      redLines: baseDoc.redLines,
      selfVision: baseDoc.selfVision,
      gateSpec: baseDoc.gateSpec,
    });
  });
});
