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

const utilSchema = z.object({
  prompt: z.string().max(120000).optional(),
  messages: z.array(messageSchema).max(20).optional(),
  system: z.string().max(20000).optional(),
  task: z.enum(["gather", "weave", "draft", "review", "revision", "outputs", "utility", "mediaPrompt", "file"]).default("utility"),
});

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = utilSchema.parse(await req.json());
    const messages = body.messages ?? (body.prompt ? [{ role: "user", content: body.prompt } satisfies AIMessage] : []);
    if (!messages.length) {
      return NextResponse.json({ error: "Provide prompt or messages.", code: "validation" }, { status: 422 });
    }
    const text = await getAIForTask(body.task as LLMTask).complete(messages as AIMessage[], body.system);
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
