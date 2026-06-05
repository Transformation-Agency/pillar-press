/** Safe error -> HTTP response mapping. Logs detail server-side, returns a
 *  generic, secret-free body to the client. */
import { NextResponse } from "next/server";
import { HedraError } from "./hedra";
import { ElevenError } from "./elevenlabs";
import { ZodError } from "zod";

export function toErrorResponse(err: unknown, requestId?: string) {
  // Structured server log WITHOUT secrets. Never log api keys or full provider bodies.
  const log = (status: number, code: string, msg: string, extra?: unknown) =>
    console.error(JSON.stringify({ level: "error", requestId, status, code, msg, extra }));

  if (err instanceof ZodError) {
    log(400, "bad_request", "validation failed", err.flatten());
    return NextResponse.json({ error: "Invalid request.", code: "bad_request", issues: err.flatten().fieldErrors }, { status: 400 });
  }
  if (err instanceof HedraError || err instanceof ElevenError) {
    log(err.status, err.code, err.message);
    // err.message is already safe/generic; details kept server-side only
    return NextResponse.json({ error: err.message, code: err.code }, { status: clientStatus(err.status) });
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
