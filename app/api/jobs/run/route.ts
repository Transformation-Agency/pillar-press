import { NextResponse } from "next/server";
import { z } from "zod";
import { BillingError } from "@/lib/billing/stripe";
import { toErrorResponse } from "@/lib/errors";
import { recoverStaleBackgroundJobs } from "@/lib/jobs/background";
import { runNextBackgroundJob } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  workerId: z.string().trim().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  recoverStaleAfterSeconds: z.number().int().min(60).max(86_400).optional(),
});

function isAuthorized(req: Request) {
  const secret = process.env.KINGS_PRESS_JOB_SECRET?.trim();
  if (!secret) {
    throw new BillingError(503, "jobs_not_configured", "Background jobs are not configured.");
  }
  const bearer = req.headers.get("authorization")?.replace(/^bearer\s+/i, "").trim();
  const header = req.headers.get("x-kings-press-job-secret")?.trim();
  return bearer === secret || header === secret;
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      throw new BillingError(401, "unauthorized", "Unauthorized.");
    }
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const limit = body.limit ?? 1;
    const workerId = body.workerId ?? `hosted-worker-${crypto.randomUUID()}`;
    const recovered = await recoverStaleBackgroundJobs({
      staleAfterMs: (body.recoverStaleAfterSeconds ?? 15 * 60) * 1000,
      limit: 50,
    });
    const results = [];
    for (let i = 0; i < limit; i += 1) {
      const result = await runNextBackgroundJob({ workerId });
      results.push(result);
      if (!result.claimed) break;
    }
    return NextResponse.json({
      workerId,
      recovered,
      processed: results.filter((result) => result.claimed).length,
      results,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
