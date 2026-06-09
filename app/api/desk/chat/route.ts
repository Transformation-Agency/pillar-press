import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getAIForTask } from "@/lib/llm";
import type { AIMessage, LLMTask } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(120000),
});

const chatSchema = z.object({
  mode: z.enum(["desk", "publication", "book", "gather", "studio"]).default("desk"),
  messages: z.array(messageSchema).max(60),
  memory: z.string().max(20000).optional().nullable(),
  task: z.enum(["gather", "weave", "draft", "review", "revision", "outputs", "utility", "mediaPrompt"]).default("utility"),
});

const modePreamble: Record<string, string> = {
  desk: "Mode: Desk — open editorial conversation. Help the author think, draft, and decide.",
  publication: "Mode: Publication — discuss shaping a long-form publishable piece. Do not run gates here; direct the author to the Publication workspace for production passes.",
  book: "Mode: Book — discuss the book's arc and chapter continuity. Do not replace the Book workspace pipeline.",
  gather: "Mode: Gather — discuss research strategy and what to gather. Live connector runs happen in the Gather screen.",
  studio: "Mode: Studio — discuss media planning. Live image, audio, and video generation happens in the Studio screen.",
};

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = chatSchema.parse(await req.json());
    const transcript = body.messages.slice(-24);
    const system = [
      "You are the King's Press Editorial Desk, a calm, precise editorial assistant.",
      "Keep replies short and load-bearing: usually 2-5 sentences.",
      "Do not claim to have run production workflows unless the browser route did so.",
      modePreamble[body.mode] || modePreamble.desk,
      body.memory ? `Earlier folded context:\n${body.memory}` : "",
    ].filter(Boolean).join("\n\n");

    const text = await getAIForTask(body.task as LLMTask).complete(transcript as AIMessage[], system);
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
