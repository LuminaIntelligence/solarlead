/**
 * admin-gate — shared auth/CSRF guard for /api/admin/* routes.
 *
 * Two layers of defense:
 *
 *   1. requireAdmin(): verifies a valid Supabase session AND that the
 *      authenticated user has role='admin' in the `user_settings` table.
 *      Crucially, this is a *server-controlled* role (DB column writable
 *      only by the service role) — it cannot be self-elevated by a user
 *      tampering with their JWT user_metadata.
 *
 *   2. requireSameOrigin(): rejects requests that do not originate from the
 *      same site, preventing CSRF attacks that exploit the admin's session
 *      cookie via a malicious page in another tab.
 *
 * Usage in any admin route handler:
 *
 *     import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
 *
 *     export async function POST(req: Request) {
 *       const gate = await requireAdminAndOrigin(req);
 *       if (gate.error) return gate.error; // already a NextResponse with status
 *       const { user, adminSupabase } = gate;
 *       // ... safe to do admin work
 *     }
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

interface GateSuccess {
  error: null;
  user: User;
  supabase: Awaited<ReturnType<typeof createClient>>;
  adminSupabase: ReturnType<typeof createAdminClient>;
}
interface GateFailure {
  error: NextResponse;
}
type GateResult = GateSuccess | GateFailure;

/**
 * Reject requests that don't come from this site's own origin.
 *
 * For same-site browsers we rely on Origin/Sec-Fetch-Site headers (sent by
 * all modern browsers on cross-origin POST/PUT/PATCH/DELETE). Server-to-server
 * traffic (e.g. cron) typically has no Origin header, which we ALLOW for
 * non-browser clients only when there is also no `Cookie` header — preventing
 * a CSRF that drops the Origin header but still rides along admin cookies.
 */
export function requireSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const cookie = req.headers.get("cookie");

  // Sec-Fetch-Site is the cleanest signal in modern browsers
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return null;
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  // Origin header path
  if (origin) {
    const host = req.headers.get("host");
    try {
      const originUrl = new URL(origin);
      if (host && originUrl.host === host) return null;
    } catch { /* fall through */ }
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  // No Origin and no Sec-Fetch-Site: allow only if no auth cookies (server-to-server)
  if (!cookie || !cookie.includes("sb-")) return null;
  return NextResponse.json({ error: "Missing origin headers on authenticated request" }, { status: 403 });
}

/**
 * Verify session + DB-backed admin role.
 *
 * The role lookup uses the service-role client so we don't depend on RLS
 * letting the authenticated user read their own role row (in case future
 * RLS tightening blocks that). The user_id we look up still comes from the
 * authenticated session — service-role is only how we read the row.
 */
export async function requireAdmin(): Promise<GateResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const adminSupabase = createAdminClient();
  const { data: profile, error: profileErr } = await adminSupabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr) {
    console.error("[admin-gate] role lookup failed:", profileErr.message);
    return { error: NextResponse.json({ error: "Auth check failed" }, { status: 500 }) };
  }

  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { error: null, user, supabase, adminSupabase };
}

/**
 * Gate for the reply-team workflow.
 *
 * Allows: admin, team_lead, reply_specialist.
 * The returned `role` lets callers branch behavior (e.g. specialists see only
 * their assigned + pool, team_leads see everything).
 */
export interface TeamGateSuccess {
  error: null;
  user: User;
  role: "admin" | "team_lead" | "reply_specialist";
  supabase: Awaited<ReturnType<typeof createClient>>;
  adminSupabase: ReturnType<typeof createAdminClient>;
}
export type TeamGateResult = TeamGateSuccess | GateFailure;

export async function requireTeamMember(): Promise<TeamGateResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const adminSupabase = createAdminClient();
  const { data: profile, error } = await adminSupabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[admin-gate] role lookup failed:", error.message);
    return { error: NextResponse.json({ error: "Auth check failed" }, { status: 500 }) };
  }
  const role = profile?.role as string | undefined;
  if (role !== "admin" && role !== "team_lead" && role !== "reply_specialist") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { error: null, user, role: role as "admin" | "team_lead" | "reply_specialist", supabase, adminSupabase };
}

export async function requireTeamMemberAndOrigin(req: Request): Promise<TeamGateResult> {
  const csrfErr = requireSameOrigin(req);
  if (csrfErr) return { error: csrfErr };
  return requireTeamMember();
}

/** True if the role can see all replies (lead or admin). */
export function canSeeAllReplies(role: string): boolean {
  return role === "admin" || role === "team_lead";
}

/**
 * One-call combined gate: same-origin check + admin role check.
 * Returns either { error: NextResponse } or { user, adminSupabase }.
 */
export async function requireAdminAndOrigin(req: Request): Promise<GateResult> {
  const csrfErr = requireSameOrigin(req);
  if (csrfErr) return { error: csrfErr };
  return requireAdmin();
}
