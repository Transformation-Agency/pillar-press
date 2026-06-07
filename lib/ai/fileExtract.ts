import { completeBlocks } from "@/lib/anthropic";

/**
 * Turn an uploaded file into research text.
 * - text-like → decode as UTF-8
 * - PDF → Claude reads the document natively (text + layout)
 * - image → Claude vision transcribes text + describes visual content
 * - .docx → mammoth extracts the raw text
 * Pure-ish (no DB); the route does auth + I/O.
 */

const PDF_PROMPT =
  "Extract the full readable content of this document as clean Markdown. Preserve headings, lists, and tables as best you can. Output ONLY the document's content — no preamble, no commentary.";

const IMG_PROMPT =
  "Convert this image into research notes. First transcribe ALL visible text verbatim. Then, if useful, add a short description of any charts, diagrams, or notable visual content. Output only the transcription and description as Markdown — no preamble.";

const TEXT_EXT = /^(txt|md|markdown|csv|tsv|json|log|html?|xml|yaml|yml|rtf)$/;
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

export interface ExtractInput {
  name: string;
  mimeType?: string;
  bytes: Buffer;
}

export async function extractFileText(input: ExtractInput): Promise<string> {
  const name = input.name || "file";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mime = (input.mimeType || "").toLowerCase();

  // Text family — decode directly, no model call.
  if (mime.startsWith("text/") || TEXT_EXT.test(ext)) {
    return input.bytes.toString("utf8");
  }

  // PDF — Claude reads it natively.
  if (mime === "application/pdf" || ext === "pdf") {
    return completeBlocks([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.bytes.toString("base64") } },
      { type: "text", text: PDF_PROMPT },
    ]);
  }

  // Images — Claude vision transcribes + describes.
  const imgMime = mime.startsWith("image/") ? mime : IMAGE_MIME[ext];
  if (imgMime) {
    return completeBlocks([
      { type: "image", source: { type: "base64", media_type: imgMime, data: input.bytes.toString("base64") } },
      { type: "text", text: IMG_PROMPT },
    ]);
  }

  // Word .docx — extract raw text with mammoth.
  if (ext === "docx" || mime.includes("officedocument.wordprocessingml")) {
    const mod: unknown = await import("mammoth");
    const m = (mod as { default?: unknown }).default ?? mod;
    const extractRawText = (m as { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> }).extractRawText;
    const res = await extractRawText({ buffer: input.bytes });
    return (res?.value || "").trim();
  }

  // Last resort: accept it if it decodes to mostly-printable text.
  const asText = input.bytes.toString("utf8");
  if (asText && !asText.slice(0, 1000).includes("�")) return asText;

  throw new Error(`Unsupported file type: ${ext || mime || "unknown"}. Try PDF, an image, .docx, or a text file.`);
}
