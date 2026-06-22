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

  it("extracts text from a real DOCX package with mammoth", async () => {
    const getFileAI = vi.fn();
    vi.doMock("@/lib/llm", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/llm")>()),
      getFileAI,
    }));
    const { extractFileText } = await import("@/lib/ai/fileExtract");
    const docx = Buffer.from(
      "UEsDBBQAAAAIAKQq1lx5bjPX6AAAAK0BAAATABwAW0NvbnRlbnRfVHlwZXNdLnhtbFVUCQADoxo5aqMaOWp1eAsAAQT2AQAABBQAAAB9UMlOwzAQ/RVrrihx4IAQitMDyxE4lA8Y2ZPEqjd53NL+PU5bekCF48xb9frV3juxo8w2BgW3bQeCgo7GhknB5/q1eQDBBYNBFwMpOBDDaujXh0QsqjawgrmU9Cgl65k8chsThYqMMXss9cyTTKg3OJG867p7qWMoFEpTFg8Y+mcaceuKeNnX96lHJscgnk7EJUsBpuSsxlJxuQvmV0pzTmir8sjh2Sa+qQSQVxMW5O+As+69DpOtIfGBubyhryz5FbORJuqtr8r2f5srPeM4Wk0X/eKWctTEXBf3rr0gHm346S+Pcw/fUEsDBAoAAAAAAKQq1lwAAAAAAAAAAAAAAAAGABwAX3JlbHMvVVQJAAOjGjlqoxo5anV4CwABBPYBAAAEFAAAAFBLAwQUAAAACACkKtZcm/036q0AAAApAQAACwAcAF9yZWxzLy5yZWxzVVQJAAOjGjlqoxo5anV4CwABBPYBAAAEFAAAAI3POw7CMAwG4KtE3mlaBoRQ0y4IqSsqB7ASN61oHkrCo7cnAwNFDIy2f3+W6/ZpZnanECdnBVRFCYysdGqyWsClP232wGJCq3B2lgQsFKFt6jPNmPJKHCcfWTZsFDCm5A+cRzmSwVg4TzZPBhcMplwGzT3KK2ri27Lc8fBpwNpknRIQOlUB6xdP/9huGCZJRydvhmz6ceIrkWUMmpKAhwuKq3e7yCzwpuarF5sXUEsDBAoAAAAAAKQq1lwAAAAAAAAAAAAAAAAFABwAd29yZC9VVAkAA6MaOWqjGjlqdXgLAAEE9gEAAAQUAAAAUEsDBBQAAAAIAKQq1lyF2bcO2wAAAEABAAARABwAd29yZC9kb2N1bWVudC54bWxVVAkAA6MaOWqjGjlqdXgLAAEE9gEAAAQUAAAAbY9LT8QwDIT/ipUDN5pdDgiVtnvgceEABxBcTeo+RBNHdpZ2/z0JEkJCXMayZvxp3Bw2v8Anic4cWrOvdgYoOO7nMLbm5fn+/MqAJgw9LhyoNSdSc+iate7ZHT2FBBkQtF5bM6UUa2vVTeRRK44UsjeweEx5ldGuLH0UdqSa+X6xF7vdpfU4B1OQ79yfyoxFpEjqHnLwDCPrtcKT5EO4fbx5g2He0lEIJsJStbElW1S+Nf7F3G1J0CVI06wQUXAUjBMMwh4QhHCB11wuW+4DR6r+Adqfgvb3+e4LUEsBAh4DFAAAAAgApCrWXHluM9foAAAArQEAABMAGAAAAAAAAQAAAKSBAAAAAFtDb250ZW50X1R5cGVzXS54bWxVVAUAA6MaOWp1eAsAAQT2AQAABBQAAABQSwECHgMKAAAAAACkKtZcAAAAAAAAAAAAAAAABgAYAAAAAAAAABAA7UE1AQAAX3JlbHMvVVQFAAOjGjlqdXgLAAEE9gEAAAQUAAAAUEsBAh4DFAAAAAgApCrWXJv9N+qtAAAAKQEAAAsAGAAAAAAAAQAAAKSBdQEAAF9yZWxzLy5yZWxzVVQFAAOjGjlqdXgLAAEE9gEAAAQUAAAAUEsBAh4DCgAAAAAApCrWXAAAAAAAAAAAAAAAAAUAGAAAAAAAAAAQAO1BZwIAAHdvcmQvVVQFAAOjGjlqdXgLAAEE9gEAAAQUAAAAUEsBAh4DFAAAAAgApCrWXIXZtw7bAAAAQAEAABEAGAAAAAAAAQAAAKSBpgIAAHdvcmQvZG9jdW1lbnQueG1sVVQFAAOjGjlqdXgLAAEE9gEAAAQUAAAAUEsFBgAAAAAFAAUAmAEAAMwDAAAAAA==",
      "base64",
    );

    const text = await extractFileText({
      name: "fixture.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: docx,
    });

    expect(text).toContain("King's Press DOCX fixture heading");
    expect(text).toContain("Extract this paragraph from a real Word package.");
    expect(getFileAI).not.toHaveBeenCalled();
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
