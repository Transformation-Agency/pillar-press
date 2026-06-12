import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, references } from "@/lib/db";
import { getLocalCampaign, getLocalReferences } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getAIForProfile, getAIForTask } from "@/lib/llm";
import type { AIMessage, LLMTask } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { toErrorResponse } from "@/lib/errors";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(120000),
});

const chatSchema = z.object({
  mode: z.enum(["desk", "publication", "book", "gather", "studio"]).default("desk"),
  messages: z.array(messageSchema).max(60),
  memory: z.string().max(20000).optional().nullable(),
  campaignId: z.string().max(120).optional().nullable(),
  llmProfileId: z.string().max(160).optional().nullable(),
  task: z.enum(["gather", "weave", "draft", "review", "revision", "outputs", "utility", "mediaPrompt"]).default("utility"),
});

const modePreamble: Record<string, string> = {
  desk: "Mode: Desk — open editorial conversation. Help the author think, draft, and decide.",
  publication: "Mode: Publication — discuss shaping a long-form publishable piece. Do not run gates here; direct the author to the Publication workspace for production passes.",
  book: "Mode: Book — discuss the book's arc and chapter continuity. Do not replace the Book workspace pipeline.",
  gather: "Mode: Gather — discuss research strategy and what to gather. Live connector runs happen in the Gather screen.",
  studio: "Mode: Studio — discuss media planning. Live image, audio, and video generation happens in the Studio screen.",
};

async function resolveRefContext(campaignId: string | null | undefined, workspaceId: string | undefined): Promise<string | null> {
  if (!campaignId) return "";
  if (!workspaceId) return null;

  if (isLocalFirstMode()) {
    const campaign = getLocalCampaign(campaignId, workspaceId);
    if (!campaign) return null;
    const ref = getLocalReferences(campaign.id, workspaceId);
    return buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
  }

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
  });
  if (!campaign) return null;

  const ref = await db.query.references.findFirst({
    where: eq(references.campaignId, campaign.id),
  });
  return buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = chatSchema.parse(await req.json());
    const refContext = await resolveRefContext(body.campaignId, user.workspaceId);
    if (refContext === null) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }
    const transcript = body.messages.slice(-24);
    const system = [
      "You are Pillar Press, a calm, precise content generation and editorial assistant.",
      "Match reply length to the request: short and load-bearing (2-5 sentences) for questions, decisions, and editorial back-and-forth. When the author asks you to write, draft, or continue a piece, write it in full — do not ask clarifying questions first; make reasonable creative choices and let the author redirect afterward.",
      "Return only the final answer for the author. Do not include hidden reasoning, scratchpad text, analysis notes, or XML-style reasoning tags such as <think> or <thinking>.",
      "Do not claim to have run production workflows unless the browser route did so.",
      "Provider-hosted web search is enabled for Desk chat on supported cloud models. Use it when the author asks for current facts, source-checking, citations, or web research. Cite sources in the answer when search was used.",
      modePreamble[body.mode] || modePreamble.desk,
      refContext ? `Approved campaign preferences and setup profile:\n${refContext}` : "",
      body.memory ? `Earlier folded context:\n${body.memory}` : "",
    ].filter(Boolean).join("\n\n");

    const ai = body.llmProfileId ? getAIForProfile(body.llmProfileId) : getAIForTask(body.task as LLMTask);
    const text = await ai.complete(transcript as AIMessage[], system, { webSearch: true });
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
