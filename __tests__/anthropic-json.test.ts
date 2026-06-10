import { describe, it, expect } from "vitest";
import { extractJSON, repairJSON } from "@/lib/llm";

describe("extractJSON", () => {
  it("parses clean JSON object", () => {
    expect(extractJSON('{"a":1,"b":"two"}')).toEqual({ a: 1, b: "two" });
  });

  it("parses clean JSON array", () => {
    expect(extractJSON('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it("strips ```json code fences", () => {
    const fenced = '```json\n{"hello":"world","n":42}\n```';
    expect(extractJSON(fenced)).toEqual({ hello: "world", n: 42 });
  });

  it("strips bare ``` code fences", () => {
    const fenced = '```\n{"x":true}\n```';
    expect(extractJSON(fenced)).toEqual({ x: true });
  });

  it("extracts a balanced object embedded in surrounding prose", () => {
    const out = 'Sure, here is the result: {"k":"v","arr":[1,2]} — done.';
    expect(extractJSON(out)).toEqual({ k: "v", arr: [1, 2] });
  });

  it("does not get confused by braces inside strings", () => {
    const out = '{"text":"a } weird { value","ok":true}';
    expect(extractJSON(out)).toEqual({ text: "a } weird { value", ok: true });
  });

  it("returns null for empty input", () => {
    expect(extractJSON("")).toBeNull();
  });

  it("returns null when no JSON is present", () => {
    expect(extractJSON("just some prose, no json here")).toBeNull();
  });

  it("returns null for truncated JSON (extract does not repair)", () => {
    const truncated = '{"a":1,"b":"unterminated';
    expect(extractJSON(truncated)).toBeNull();
  });
});

describe("repairJSON", () => {
  it("closes an unterminated string and open brace", () => {
    const truncated = '{"a":1,"b":"unterminated';
    expect(repairJSON(truncated)).toEqual({ a: 1, b: "unterminated" });
  });

  it("closes nested open brackets", () => {
    const truncated = '{"items":[{"id":1},{"id":2';
    const r = repairJSON<{ items: { id: number }[] }>(truncated);
    expect(r).not.toBeNull();
    expect(r!.items[0]).toEqual({ id: 1 });
  });

  it("drops a trailing dangling key by progressive field removal", () => {
    // Trailing "c": is incomplete; repair should drop it and keep a,b.
    const truncated = '{"a":1,"b":2,"c":';
    expect(repairJSON(truncated)).toEqual({ a: 1, b: 2 });
  });

  it("repairs a truncated array", () => {
    const truncated = '[1,2,3,4';
    expect(repairJSON(truncated)).toEqual([1, 2, 3, 4]);
  });

  it("repairs JSON truncated mid trailing field", () => {
    const truncated = '{"name":"deck","slides":[{"title":"Intro","body":"hello wor';
    const r = repairJSON<{ name: string; slides: { title: string }[] }>(truncated);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("deck");
    expect(r!.slides[0].title).toBe("Intro");
  });

  it("returns the clean object for already-valid JSON", () => {
    expect(repairJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for empty input", () => {
    expect(repairJSON("")).toBeNull();
  });

  it("returns null when no JSON start token exists", () => {
    expect(repairJSON("no json at all")).toBeNull();
  });
});
