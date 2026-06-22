import type { AI, ResolvedTaskAI } from "@/lib/llm";
import { buildTextChunks, estimateTokens, fitsSinglePass, llmBudgetForResolvedTask } from "@/lib/llm/budget";
import type { CategoryContext } from "@/lib/editorial/categoryContext";
import { withCategoryPrompt } from "@/lib/editorial/categoryContext";
import {
  buildFindingsBlock,
  buildFullFindingsBlock,
  generateRevision,
  parseDelimited,
  RESTRUCTURE_SYSTEM,
  type ChangelogEntry,
  type RevisionOptions,
  type RevisionPieceInput,
  type RevisionResult,
} from "@/lib/revision";

export type RevisionPlan = "light_polish" | "structural_then_polish" | "chunked_structural_plan_then_polish";

export interface RevisionTraceStage {
  id: string;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  warning?: string;
}

export interface RevisionTrace {
  category: CategoryContext["category"];
  categoryLabel: string;
  plan: RevisionPlan;
  chunks: number;
  provider?: string | null;
  model?: string | null;
  warnings: string[];
  stages: RevisionTraceStage[];
}

export interface RevisionWithTrace extends RevisionResult {
  status?: "running" | "complete" | "failed";
  trace?: RevisionTrace;
}

function makeTrace(input: {
  categoryCtx: CategoryContext;
  plan: RevisionPlan;
  chunks: number;
  taskAI: Pick<ResolvedTaskAI, "provider" | "model">;
  warnings?: string[];
}): RevisionTrace {
  return {
    category: input.categoryCtx.category,
    categoryLabel: input.categoryCtx.traceLabel,
    plan: input.plan,
    chunks: input.chunks,
    provider: input.taskAI.provider ?? null,
    model: input.taskAI.model ?? null,
    warnings: input.warnings ?? [],
    stages: [],
  };
}

function stage(trace: RevisionTrace, id: string, label: string, status: RevisionTraceStage["status"], warning?: string) {
  const existing = trace.stages.find((s) => s.id === id);
  const next = {
    id,
    label,
    status,
    startedAt: existing?.startedAt ?? (status === "running" ? new Date().toISOString() : undefined),
    finishedAt: ["succeeded", "failed"].includes(status) ? new Date().toISOString() : existing?.finishedAt,
    warning,
  };
  if (existing) Object.assign(existing, next);
  else trace.stages.push(next);
}

function choosePlan(input: {
  piece: RevisionPieceInput;
  refCtx: string;
  categoryCtx: CategoryContext;
  taskAI: Pick<ResolvedTaskAI, "provider" | "model">;
  mode: "light" | "full";
}): { plan: RevisionPlan; chunks: ReturnType<typeof buildTextChunks>; warnings: string[] } {
  const ref = withCategoryPrompt(input.refCtx, input.categoryCtx);
  const budget = llmBudgetForResolvedTask(input.taskAI);
  const draft = input.piece.original || "";
  const system = RESTRUCTURE_SYSTEM(ref);
  const prompt = `${buildFullFindingsBlock(input.piece.packet || {})}\n\n${draft}`;
  const chunks = buildTextChunks(draft, { maxTokens: 1_600, overlapTokens: 0, preferHeadings: true });
  if (input.mode !== "full") return { plan: "light_polish", chunks, warnings: chunks.length > 1 ? [`revision_chunked:${chunks.length}`] : [] };
  if (input.categoryCtx.revisionModeDefaults?.allowStructuralPass === false) {
    return {
      plan: "light_polish",
      chunks,
      warnings: ["category_structural_pass_disabled"].concat(chunks.length > 1 ? [`revision_chunked:${chunks.length}`] : []),
    };
  }
  const wholeDocOk = fitsSinglePass({ system, prompt, budget, safetyMarginTokens: 2_000 });
  if (wholeDocOk) return { plan: "structural_then_polish", chunks, warnings: chunks.length > 1 ? [`revision_chunked:${chunks.length}`] : [] };
  return { plan: "chunked_structural_plan_then_polish", chunks, warnings: [`long_input_staged:${chunks.length}`] };
}

async function buildStructuralPlan(input: {
  piece: RevisionPieceInput;
  refCtx: string;
  categoryCtx: CategoryContext;
  chunks: ReturnType<typeof buildTextChunks>;
  ai: AI;
}): Promise<{ planText: string; calls: number }> {
  const system = RESTRUCTURE_SYSTEM(withCategoryPrompt(input.refCtx, input.categoryCtx));
  const findings = buildFullFindingsBlock(input.piece.packet || {});
  const summaries: string[] = [];
  for (const chunk of input.chunks) {
    const out = await input.ai.text(`Read ${chunk.label} and name only structural opportunities visible here. Do not rewrite yet.

FINDINGS:
${findings}

CHUNK:
"""${chunk.text}"""`, { system });
    summaries.push(`${chunk.label}: ${out.slice(0, 2_000)}`);
  }
  const reduced = await input.ai.text(`Reduce these section notes into a bounded structural plan for the full draft. Do not invent facts.

${summaries.join("\n\n").slice(0, 40_000)}`, { system });
  return { planText: reduced.slice(0, 6_000), calls: input.chunks.length + 1 };
}

async function reviseChunkWithPlan(input: {
  chunkText: string;
  label: string;
  piece: RevisionPieceInput;
  refCtx: string;
  categoryCtx: CategoryContext;
  structuralPlan: string;
  ai: AI;
}): Promise<{ text: string; changelog: ChangelogEntry[] }> {
  const system = RESTRUCTURE_SYSTEM(withCategoryPrompt(input.refCtx, input.categoryCtx));
  const out = await input.ai.text(`Apply this bounded structural plan only where relevant to ${input.label}, then return the delimited revision format.

STRUCTURAL PLAN:
${input.structuralPlan}

FIREWALL FINDINGS FOR LATER POLISH AWARENESS:
${buildFindingsBlock(input.piece.packet || {})}

${input.label.toUpperCase()}:
"""${input.chunkText}"""`, { system });
  const parsed = parseDelimited(out, /^\[\s*([A-Za-z0-9]{1,12})\s*\]/);
  return { text: parsed.revision || input.chunkText, changelog: parsed.changelog };
}

export async function runCategoryAwareRevision(input: {
  piece: RevisionPieceInput;
  refCtx: string;
  categoryCtx: CategoryContext;
  taskAI: Pick<ResolvedTaskAI, "provider" | "model">;
  ai: AI;
  opts?: RevisionOptions;
  onProgress?: (revision: RevisionWithTrace) => Promise<void> | void;
}): Promise<{ revision: RevisionWithTrace; callCount: number }> {
  const mode = input.opts?.mode === "full" ? "full" : "light";
  const plan = choosePlan({ piece: input.piece, refCtx: input.refCtx, categoryCtx: input.categoryCtx, taskAI: input.taskAI, mode });
  const trace = makeTrace({ categoryCtx: input.categoryCtx, plan: plan.plan, chunks: plan.chunks.length, taskAI: input.taskAI, warnings: plan.warnings });
  let callCount = 0;
  await input.onProgress?.({ text: "", changelog: [], status: "running", trace });

  if (plan.plan !== "chunked_structural_plan_then_polish") {
    const effectiveMode = plan.plan === "light_polish" ? "light" : mode;
    stage(trace, effectiveMode === "full" ? "structure" : "polish", effectiveMode === "full" ? "Restructuring and polishing" : "Polishing passages", "running");
    let progressCalls = 0;
    let progressTotal = plan.chunks.length;
    const result = await generateRevision(
      { ...input.piece, categoryContext: input.categoryCtx } as RevisionPieceInput,
      withCategoryPrompt(input.refCtx, input.categoryCtx),
      input.ai,
      async (done, total) => {
        progressCalls = Math.max(progressCalls, done);
        progressTotal = Math.max(progressTotal, total);
        await input.onProgress?.({ text: "", changelog: [], status: "running", trace: { ...trace, chunks: total } });
      },
      { mode: effectiveMode },
    );
    trace.chunks = Math.max(trace.chunks, progressTotal);
    if (trace.chunks > 1 && !trace.warnings.some((warning) => /^revision_chunked:/.test(warning))) {
      trace.warnings.push(`revision_chunked:${trace.chunks}`);
    }
    callCount = (effectiveMode === "full" ? 1 : 0) + Math.max(progressCalls, plan.chunks.length);
    stage(trace, effectiveMode === "full" ? "structure" : "polish", effectiveMode === "full" ? "Restructuring and polishing" : "Polishing passages", "succeeded");
    return { revision: { ...result, status: "complete", trace }, callCount };
  }

  const structuralInput = { ...input.piece, categoryContext: input.categoryCtx } as RevisionPieceInput;
  let baseText = input.piece.original || "";
  let changelog: ChangelogEntry[] = [];
  try {
    stage(trace, "plan", "Planning structure", "running");
    await input.onProgress?.({ text: "", changelog, status: "running", trace });
    const structural = await buildStructuralPlan({ piece: structuralInput, refCtx: input.refCtx, categoryCtx: input.categoryCtx, chunks: plan.chunks, ai: input.ai });
    callCount += structural.calls;
    stage(trace, "plan", "Planning structure", "succeeded");

    const revisedSections: string[] = [];
    for (const chunk of plan.chunks) {
      stage(trace, `section-${chunk.index}`, `Revising section ${chunk.index} of ${chunk.total}`, "running");
      await input.onProgress?.({ text: revisedSections.join("\n\n"), changelog, status: "running", trace });
      const revised = await reviseChunkWithPlan({
        chunkText: chunk.text,
        label: chunk.label,
        piece: structuralInput,
        refCtx: input.refCtx,
        categoryCtx: input.categoryCtx,
        structuralPlan: structural.planText,
        ai: input.ai,
      });
      callCount += 1;
      revisedSections.push(revised.text);
      changelog = changelog.concat(revised.changelog);
      stage(trace, `section-${chunk.index}`, `Revising section ${chunk.index} of ${chunk.total}`, "succeeded");
    }
    baseText = revisedSections.join("\n\n");
  } catch (err) {
    trace.warnings.push("structural_stage_failed_fallback_to_polish");
    stage(trace, "plan", "Planning structure", "failed", err instanceof Error ? err.message : "Structural planning failed");
  }

  stage(trace, "polish", "Polishing passages", "running");
  const polished = await generateRevision(
    { ...structuralInput, original: baseText },
    withCategoryPrompt(input.refCtx, input.categoryCtx),
    input.ai,
    async (_done, total) => {
      await input.onProgress?.({ text: baseText, changelog, status: "running", trace: { ...trace, chunks: total } });
    },
    { mode: "light" },
  );
  callCount += Math.max(1, plan.chunks.length);
  stage(trace, "polish", "Polishing passages", "succeeded");
  return { revision: { text: polished.text, changelog: changelog.concat(polished.changelog), status: "complete", trace }, callCount };
}
