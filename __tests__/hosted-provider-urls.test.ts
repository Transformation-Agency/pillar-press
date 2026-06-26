import { describe, expect, it } from "vitest";
import { HostedProviderUrlError, normalizeHostedProviderBaseUrl } from "@/lib/hostedProviderUrls";

describe("hosted provider base URL guard", () => {
  it("normalizes public HTTPS provider URLs", () => {
    expect(normalizeHostedProviderBaseUrl(" https://api.openai.com/v1/ ")).toBe("https://api.openai.com/v1");
    expect(normalizeHostedProviderBaseUrl(undefined)).toBeUndefined();
  });

  it("rejects non-HTTPS and embedded credentials", () => {
    expect(() => normalizeHostedProviderBaseUrl("http://api.example.com/v1")).toThrow(HostedProviderUrlError);
    expect(() => normalizeHostedProviderBaseUrl("https://user:pass@api.example.com/v1")).toThrow(HostedProviderUrlError);
  });

  it("rejects localhost and private-network targets", () => {
    const unsafe = [
      "https://localhost:11434",
      "https://service.local/v1",
      "https://127.0.0.1:11434",
      "https://10.0.0.2/v1",
      "https://172.16.0.2/v1",
      "https://192.168.1.20/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/v1",
      "https://[fd00::1]/v1",
    ];

    for (const url of unsafe) {
      expect(() => normalizeHostedProviderBaseUrl(url), url).toThrow(HostedProviderUrlError);
    }
  });
});
