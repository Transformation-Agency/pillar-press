import { uploadPublicAudio } from "@/lib/storage";
import type { AudioProviderConfig } from "@/lib/mediaProviders";

const OPENAI_VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]);

export async function generateOpenAICompatibleSpeech(input: {
  config: AudioProviderConfig;
  model: string;
  text: string;
  voice?: string;
}) {
  const voice = input.voice && OPENAI_VOICES.has(input.voice) ? input.voice : "alloy";
  const res = await fetch(`${input.config.baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      input: input.text,
      voice,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw new Error(`Audio provider request failed (${res.status}).`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const outputUrl = await uploadPublicAudio(bytes, `voiceover-${Date.now()}.mp3`);
  return { outputUrl, downloadUrl: outputUrl, voice };
}
