/** Safe error -> HTTP response mapping. Logs detail server-side, returns a
 *  generic, secret-free body to the client. */
import { NextResponse } from "next/server";
import { HedraError } from "./hedra";
import { ElevenError } from "./elevenlabs";
import { DriveError } from "./driveError";
import { GatherError } from "./gather";
import { LLMError } from "./llm";
import { ZodError } from "zod";

export function toErrorResponse(err: unknown, requestId?: string) {
  // Structured server log WITHOUT secrets. Never log api keys or full provider bodies.
  const log = (status: number, code: string, msg: string, extra?: unknown) =>
    console.error(JSON.stringify({ level: "error", requestId, status, code, msg, extra }));

  if (err instanceof ZodError) {
    log(400, "bad_request", "validation failed", err.flatten());
    return NextResponse.json({ error: "Invalid request.", code: "bad_request", issues: err.flatten().fieldErrors }, { status: 400 });
  }
  if (err instanceof HedraError || err instanceof ElevenError || err instanceof DriveError || err instanceof GatherError || err instanceof LLMError) {
    log(err.status, err.code, err.message);
    // err.message is already safe/generic; details kept server-side only
    return NextResponse.json({ error: err.message, code: err.code }, { status: clientStatus(err.status) });
  }
  // Auth-layer errors (lib/auth.ts requireUser/requireRole/assertAuthor): plain
  // Error tagged with a numeric .status (401/403). Pass these 4xx codes through
  // as-is — do NOT collapse 403→401 the way provider key errors do, since the
  // distinction (unauthenticated vs forbidden role) is meaningful here.
  const authStatus = (err as { status?: unknown })?.status;
  if (typeof authStatus === "number" && authStatus >= 400 && authStatus < 500) {
    const rawCode = (err as { code?: unknown })?.code;
    const code = typeof rawCode === "string" ? rawCode : authStatus === 401 ? "unauthorized" : authStatus === 403 ? "forbidden" : "error";
    const msg = authStatus === 401 ? "Unauthorized." : authStatus === 403 ? "Forbidden." : "Request error.";
    log(authStatus, code, msg);
    return NextResponse.json({ error: msg, code }, { status: authStatus });
  }
  log(500, "internal", (err as Error)?.message ?? "unknown");
  return NextResponse.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}

// Don't leak upstream 5xx detail; collapse to 502/500 ranges for the client.
function clientStatus(s: number): number {
  if (s === 401 || s === 403) return 401; // ask user to reconnect; key issue is server-side config
  if ([400, 402, 404, 409, 422, 429].includes(s)) return s;
  return s >= 500 ? 502 : s;
}
