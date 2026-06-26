import { NextResponse } from "next/server";
import { isAuthDisabled } from "@/lib/auth";
import { isHostedWebMode, isLocalFirstMode } from "@/lib/local/mode";
import { publicSupabaseUrl, supabaseAnonKey } from "@/lib/supabase";

export async function GET() {
  const localFirst = isLocalFirstMode();
  const hosted = isHostedWebMode();
  const authDisabled = isAuthDisabled();
  const requiresLogin = hosted && !localFirst && !authDisabled;
  const supabaseUrl = publicSupabaseUrl();
  const anonKey = supabaseAnonKey();

  return NextResponse.json({
    hosted,
    localFirst,
    authDisabled,
    requiresLogin,
    ready: !requiresLogin || Boolean(supabaseUrl && anonKey),
    supabaseUrl: requiresLogin ? supabaseUrl : null,
    supabaseAnonKey: requiresLogin ? anonKey : null,
  });
}
