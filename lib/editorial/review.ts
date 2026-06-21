import { GATES, PREAMBLE, runGate, type Gate, type GateResult } from "@/lib/gates";
import type { AI, ResolvedTaskAI } from "@/lib/llm";
import { buildTextChunks, estimateTokens, fitsSinglePass, llmBudgetForResolvedTask } from "@/lib/llm/budget";
import type { CategoryContext } from "@/lib/editorial/categoryContext";
import { withCategoryPrompt } from "@/lib/editorial/categoryContext";

export type ReviewPlan = "single_pass" | "chunked_reduce";

export interface ReviewTraceStage {
  id: string;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  warning?: string;
}

export interface ReviewTrace {
  category: CategoryContext["category"];
  categoryLabel: string;
  plan: ReviewPlan;
  chunks: number;
  provider?: string | null;
  model?: string | null;
  warnings: string[];
  stages: ReviewTraceStage[];
}

export type PacketWithTrace = Record<string, GateResult | ReviewTrace> & { __trace?: ReviewTrace };

export function buildReviewTrace(input: {
  categoryCtx: CategoryContext;
  plan: ReviewPlan;
  chunks: number;
  taskAI?: Pick<ResolvedTaskAI, "provider" | "model"> | null;
  warnings?: string[];
}): ReviewTrace {
  return {
    category: input.categoryCtx.category,
    categoryLabel: input.categoryCtx.traceLabel,
    plan: input.plan,
    chunks: input.chunks,
    provider: input.taskAI?.provider ?? null,
    model: input.taskAI?.model ?? null,
    warnings: input.warnings ?? [],
    stages: GATES.map((gate) => ({ id: gate.id, label: gate.name, status: "pending" })),
  };
}

export function chooseReviewPlan(input: {
  draft: string;
  refCtx: string;
  categoryCtx: CategoryContext;
  taskAI?: Pick<ResolvedTaskAI, "provider" | "model"> | null;
}): { plan: ReviewPlan; chunks: ReturnType<typeof buildTextChunks>; warnings: string[] } {
  const promptRef = withCategoryPrompt(input.refCtx, input.categoryCtx);
  const budget = llmBudgetForResolvedTask(input.taskAI);
  const probeGate = GATES.reduce((longest, gate) =>
    estimateTokens(gate.task(input.draft)) > estimateTokens(longest.task(input.draft)) ? gate : longest, GATES[0]);
  const single = fitsSinglePass({
    system: PREAMBLE(promptRef),
    prompt: probeGate.task(input.draft),
    budget,
  });
  if (single) return { plan: "single_pass", chunks: [{ index: 1, total: 1, text: input.draft, label: "single pass" }], warnings: [] };

  const maxTokens = Math.max(1_800, Math.floor((budget.contextTokens - budget.responseReserve - estimateTokens(PREAMBLE(promptRef)) - 1_500) * 0.7));
  const chunks = buildTextChunks(input.draft, { maxTokens, overlapTokens: 120, preferHeadings: true });
  return {
    plan: "chunked_reduce",
    chunks,
    warnings: [`long_input_chunked:${chunks.length}`],
  };
}

export async function runGateWithContext(
  gate: Gate,
  draft: string,
  input: { refCtx: string; categoryCtx: CategoryContext; ai: AI; chunkLabel?: string; reviewScope?: string },
): Promise<GateResult> {
  const scopedDraft = input.chunkLabel
    ? `${input.reviewScope || "Review this excerpt as part of the full draft."}\n\n${input.chunkLabel.toUpperCase()}:\n"""${draft}"""`
    : draft;
  return runGate(gate, scopedDraft, withCategoryPrompt(input.refCtx, input.categoryCtx), input.ai);
}

async function reduceGateResults(
  gate: Gate,
  results: GateResult[],
  input: { refCtx: string; categoryCtx: CategoryContext; ai: AI },
): Promise<GateResult> {
  const system = PREAMBLE(withCategoryPrompt(input.refCtx, input.categoryCtx));
  const prompt = `TASK - Reduce chunk-level results for "${gate.name}" into ONE canonical gate result matching the original schema.
Preserve the gate's JSON shape and include a findings array. Keep anchors as short verbatim phrases from the draft excerpts when available. Prioritize the most important 2-5 findings.

GATE SCHEMA/PROMPT REFERENCE:
${gate.task("[draft omitted for reducer]")}

CHUNK RESULTS:
${JSON.stringify(results).slice(0, 60_000)}

Return ONLY the canonical JSON object for this gate.`;
  const reduced = await input.ai.json<GateResult>(prompt, { system });
  reduced.findings = Array.isArray(reduced.findings) ? reduced.findings : [];
  return reduced;
}

export async function runCategoryAwareReview(input: {
  draft: string;
  refCtx: string;
  categoryCtx: CategoryContext;
  taskAI: Pick<ResolvedTaskAI, "provider" | "model">;
  ai: AI;
  existingPacket?: Record<string, GateResult> | null;
  onGate?: (packet: PacketWithTrace, trace: ReviewTrace) => Promise<void> | void;
}): Promise<{ packet: PacketWithTrace; trace: ReviewTrace; callCount: number }> {
  const plan = chooseReviewPlan(input);
  const trace = buildReviewTrace({
    categoryCtx: input.categoryCtx,
    plan: plan.plan,
    chunks: plan.chunks.length,
    taskAI: input.taskAI,
    warnings: plan.warnings,
  });
  const packet: PacketWithTrace = { ...((input.existingPacket as Record<string, GateResult> | null) ?? {}), __trace: trace };
  let callCount = 0;

  for (let gateIndex = 0; gateIndex < GATES.length; gateIndex++) {
    const gate = GATES[gateIndex];
    trace.stages[gateIndex] = { ...trace.stages[gateIndex], status: "running", startedAt: new Date().toISOString() };
    packet.__trace = trace;
    await input.onGate?.(packet, trace);
    try {
      let result: GateResult;
      if (plan.plan === "single_pass") {
        result = await runGateWithContext(gate, input.draft, { refCtx: input.refCtx, categoryCtx: input.categoryCtx, ai: input.ai });
        callCount += 1;
      } else {
        const chunkResults: GateResult[] = [];
        for (const chunk of plan.chunks) {
          chunkResults.push(await runGateWithContext(gate, chunk.text, {
            refCtx: input.refCtx,
            categoryCtx: input.categoryCtx,
            ai: input.ai,
            chunkLabel: chunk.label,
            reviewScope: `This is ${chunk.label} of a longer ${input.categoryCtx.traceLabel.toLowerCase()}. Identify issues visible in this chunk only; reducers will merge duplicates.`,
          }));
          callCount += 1;
        }
        result = await reduceGateResults(gate, chunkResults, { refCtx: input.refCtx, categoryCtx: input.categoryCtx, ai: input.ai });
        callCount += 1;
      }
      packet[gate.id] = result;
      trace.stages[gateIndex] = { ...trace.stages[gateIndex], status: "succeeded", finishedAt: new Date().toISOString() };
    } catch (err) {
      trace.stages[gateIndex] = {
        ...trace.stages[gateIndex],
        status: "failed",
        finishedAt: new Date().toISOString(),
        warning: err instanceof Error ? err.message : "Gate failed",
      };
      trace.warnings.push(`gate_failed:${gate.id}`);
      throw err;
    } finally {
      packet.__trace = trace;
      await input.onGate?.(packet, trace);
    }
  }

  return { packet, trace, callCount };
}
