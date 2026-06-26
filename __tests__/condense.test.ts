import { describe, expect, it, vi } from "vitest";
import { condensePost } from "@/lib/ai/condense";
import type { AI } from "@/lib/llm";

function fakeAI(output: string): AI {
  return {
    complete: vi.fn(async () => output),
    extractJSON: vi.fn(),
    repairJSON: vi.fn(),
    text: vi.fn(),
    json: vi.fn(),
  } as unknown as AI;
}

describe("condensePost", () => {
  it("asks for the requested reduction and extracts the delimited post", async () => {
    const ai = fakeAI("@@POST@@\nA tighter platform post.\n@@END@@\nignored tail");

    await expect(condensePost("one two three four five", "Voice notes", 0.4, ai)).resolves.toBe(
      "A tighter platform post.",
    );
    expect(ai.complete).toHaveBeenCalledTimes(1);
    const [[messages, system]] = (ai.complete as ReturnType<typeof vi.fn>).mock.calls;
    expect(messages[0].content).toContain("ORIGINAL POST (5 words)");
    expect(system).toContain("Cut it to about 60% of its current length");
    expect(system).toContain("AUTHOR REFERENCES:\nVoice notes");
    expect(system).toContain("@@POST@@");
  });

  it("trims raw output and falls back to the original post if the model returns empty text", async () => {
    await expect(condensePost("Original post.", "", 0.4, fakeAI("  Raw tighter post.  "))).resolves.toBe(
      "Raw tighter post.",
    );
    await expect(condensePost("Original post.", "", 0.4, fakeAI("@@POST@@\n  \n@@END@@"))).resolves.toBe(
      "Original post.",
    );
  });
});
