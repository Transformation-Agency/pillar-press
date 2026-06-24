import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop native provider settings", () => {
  it("seeds OpenAI and xAI media provider settings from saved desktop LLM settings", () => {
    const source = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

    expect(source).toContain("fn save_llm_settings");
    expect(source).toContain("let mut media_providers = read_desktop_settings(&app)");
    expect(source).toContain("let saved_media_api_key = media_providers");
    expect(source).toContain(".or(saved_media_api_key)");
    expect(source).toContain('p.provider.eq_ignore_ascii_case("openai") || p.provider.eq_ignore_ascii_case("xai")');
    expect(source).toContain('let media_provider = if profile.provider.eq_ignore_ascii_case("xai")');
    expect(source).toContain("media_provider.into()");
    expect(source).toContain('base_url: profile\n                    .base_url\n                    .clone()');
    expect(source).toContain('Some(if media_provider == "xai"');
    expect(source).toContain('"https://api.x.ai/v1".into()');
    expect(source).toContain('"https://api.openai.com/v1".into()');
    expect(source).toContain("api_key: profile.api_key.clone()");
    expect(source).not.toContain("sk-test");
  });
});
