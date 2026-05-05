import { NextResponse } from "next/server";
import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { runImapSync, isImapConfigured } from "@/lib/team/imap-sync";

/**
 * POST /api/admin/outreach/sync-replies
 * Manueller IMAP-Pull-Trigger fürs Admin-UI (Sync-Button auf
 * /admin/outreach/replies). Reine Wrapper um runImapSync() — die
 * eigentliche Logik liegt geteilt in lib/team/imap-sync.ts und wird
 * auch vom Cron-Endpoint aufgerufen.
 */
export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  const result = await runImapSync();

  if (!result.configured) {
    return NextResponse.json(
      { error: result.errorMessage, configured: false },
      { status: 400 }
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.errorMessage, configured: true },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    messagesChecked: result.messagesChecked,
    repliesFound: result.repliesFound,
    optedOutFound: result.optedOutFound,
    errors: result.errors,
    configured: true,
    syncedAt: new Date().toISOString(),
  });
}

/**
 * GET /api/admin/outreach/sync-replies
 * Returns IMAP configuration status (without credentials).
 */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  return NextResponse.json({
    configured: isImapConfigured(),
    host: process.env.IMAP_HOST ?? null,
    user: process.env.IMAP_USER ?? null,
  });
}
