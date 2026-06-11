import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getAIForTask } from "@/lib/llm";
import type { AIMessage, LLMTask } from "@/lib/llm";
import type { UsageEventTask } from "@/lib/db";
import { toErrorResponse } from "@/lib/errors";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";

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
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const body = utilSchema.parse(await req.json());
    const messages = body.messages ?? (body.prompt ? [{ role: "user", content: body.prompt } satisfies AIMessage] : []);
    if (!messages.length) {
      return NextResponse.json({ error: "Provide prompt or messages.", code: "validation" }, { status: 422 });
    }
    const usageTask: UsageEventTask =
      body.task === "file"
        ? "file_extract"
        : body.task === "mediaPrompt" || body.task === "draft"
          ? "utility"
          : body.task;
    reservation = await reserveUsage({
      user,
      task: usageTask,
      feature: `llm.util.${body.task}`,
      estimatedCredits: Math.max(1, Math.ceil(JSON.stringify(messages).length / 12000)),
    });
    const text = await getAIForTask(body.task as LLMTask).complete(messages as AIMessage[], body.system);
    await completeUsageReservation(reservation, {
      actualCredits: Math.max(1, Math.ceil((JSON.stringify(messages).length + text.length) / 12000)),
    });
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
