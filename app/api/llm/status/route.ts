import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publicLLMStatus } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(publicLLMStatus());
  } catch (err) {
    return toErrorResponse(err);
  }
}
