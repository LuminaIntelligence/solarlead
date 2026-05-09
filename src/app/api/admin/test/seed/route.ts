import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { runTestSeed } from "@/lib/test-mode/seed";

/**
 * POST /api/admin/test/seed
 * Erstellt einen kompletten Test-Run: 30 Leads + Batch + Specialists.
 * Body: { count?: number } — Anzahl Leads (default 30, max 100).
 */
export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(parseInt(String(body.count ?? 30), 10) || 30, 1), 100);

  try {
    const result = await runTestSeed(count);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seed fehlgeschlagen" },
      { status: 500 }
    );
  }
}
