import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { runTestReset } from "@/lib/test-mode/seed";

/**
 * POST /api/admin/test/reset
 * Body:
 *   { batchId: "<uuid>" } → nur diesen Run löschen
 *   { batchId: null }     → ALLES mit is_test_data=true (inkl. Specialists)
 */
export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => ({}));
  const batchId = (body.batchId as string | null | undefined) ?? null;

  try {
    const result = await runTestReset(batchId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reset fehlgeschlagen" },
      { status: 500 }
    );
  }
}
