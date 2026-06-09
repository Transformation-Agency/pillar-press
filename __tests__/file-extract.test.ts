import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMError } from "@/lib/llm";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("extractFileText provider selection", () => {
  it("decodes text files locally without touching the file LLM", async () => {
    const getFileAI = vi.fn();
    vi.doMock("@/lib/llm", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/llm")>()),
      getFileAI,
    }));
    const { extractFileText } = await import("@/lib/ai/fileExtract");

    await expect(extractFileText({
      name: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("hello"),
    })).resolves.toBe("hello");
    expect(getFileAI).not.toHaveBeenCalled();
  });

  it("routes images through the configured vision file provider", async () => {
    const completeBlocks = vi.fn(async () => "image notes");
    const getFileAI = vi.fn(() => ({ completeBlocks }));
    vi.doMock("@/lib/llm", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/llm")>()),
      getFileAI,
    }));
    const { extractFileText } = await import("@/lib/ai/fileExtract");

    await expect(extractFileText({
      name: "frame.png",
      mimeType: "image/png",
      bytes: Buffer.from("png"),
    })).resolves.toBe("image notes");
    expect(getFileAI).toHaveBeenCalledWith("vision");
    expect(completeBlocks).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ type: "image" }),
      expect.objectContaining({ type: "text" }),
    ]));
  });

  it("surfaces unsupported multimodal extraction clearly", async () => {
    const getFileAI = vi.fn(() => {
      throw new LLMError(422, "llm_unsupported", "PDF extraction requires a configured multimodal LLM provider.");
    });
    vi.doMock("@/lib/llm", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/llm")>()),
      getFileAI,
    }));
    const { extractFileText } = await import("@/lib/ai/fileExtract");

    await expect(extractFileText({
      name: "paper.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF"),
    })).rejects.toMatchObject({ code: "llm_unsupported" });
  });
});
