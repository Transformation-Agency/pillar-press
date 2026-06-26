import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
import { localStorageDir } from "@/lib/local/paths";

export const runtime = "nodejs";

const safeContentType = (value: string | null): string =>
  value && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value)
    ? value
    : "application/octet-stream";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    await requireUser();
    if (!isLocalFirstMode()) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }

    const { path } = await ctx.params;
    const root = resolve(localStorageDir());
    const filePath = resolve(join(root, ...path));
    const rel = relative(root, filePath);
    if (rel.startsWith("..") || rel === "" || rel.startsWith("/")) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }

    const body = await readFile(filePath);
    const contentType = safeContentType(new URL(req.url).searchParams.get("contentType"));
    return new NextResponse(body, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return toErrorResponse(error);
    }
    return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
  }
}
