import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachEmail } from "@/lib/providers/email/templates";
import { sendEmail } from "@/lib/providers/email/mailgun";
import type { TemplateType } from "@/lib/providers/email/templates";

import { requireAdmin, requireAdminAndOrigin } from "@/lib/auth/admin-gate";
function isAdmin(user: { user_metadata?: { role?: string } } | null) {
  return user?.user_metadata?.role === "admin";
}

// POST /api/admin/discovery/[id]/test-email
// Body: { to: string, template_type: TemplateType, lead_id?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const { id: campaignId } = await params;
  const body = await req.json();
  const { to, template_type, lead_id }: {
    to: string;
    template_type: TemplateType;
    lead_id?: string;
  } = body;

  if (!to || !template_type) {
    return NextResponse.json({ error: "to und template_type sind erforderlich" }, { status: 400 });
  }

  // Verify campaign exists
  const { data: campaign } = await supabase
    .from("discovery_campaigns")
    .select("id, name")
    .eq("id", campaignId)
    .single();

  if (!campaign) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  // Load lead data for realistic preview (optional)
  let contactName: string | null = null;
  let contactTitle: string | null = null;
  let companyName = "Musterfirma GmbH";
  let city = "München";
  let category = "logistics";
  let roofAreaM2: number | null = 850;

  if (lead_id) {
    // Use specific discovery lead
    const { data: dl } = await supabase
      .from("discovery_leads")
      .select("company_name, city, category, max_array_area_m2, roof_area_m2, lead_id")
      .eq("id", lead_id)
      .eq("campaign_id", campaignId)
      .single();

    if (dl) {
      companyName = dl.company_name ?? companyName;
      city = dl.city ?? city;
      category = dl.category ?? category;
      roofAreaM2 = (dl.roof_area_m2 ?? dl.max_array_area_m2) ?? roofAreaM2;

      // Try to fetch a contact from the linked solar_lead_mass
      if (dl.lead_id) {
        // Prefer contacts with a title (named person) over generic office entries
        const { data: contacts } = await supabase
          .from("lead_contacts")
          .select("name, title")
          .eq("lead_id", dl.lead_id)
          .not("email", "is", null);

        const contact = contacts?.sort((a, b) => {
          // Named person with title comes first
          const aScore = (a.title ? 2 : 0) + (a.name && !a.name.toLowerCase().includes("stelle") && !a.name.toLowerCase().includes("büro") ? 1 : 0);
          const bScore = (b.title ? 2 : 0) + (b.name && !b.name.toLowerCase().includes("stelle") && !b.name.toLowerCase().includes("büro") ? 1 : 0);
          return bScore - aScore;
        })?.[0] ?? null;

        if (contact) {
          contactName = contact.name;
          contactTitle = contact.title;
        }
      }
    }
  }

  // Generate email
  const { subject, text, html } = generateOutreachEmail({
    contactName,
    contactTitle,
    companyName,
    city,
    category,
    roofAreaM2,
    templateType: template_type,
  });

  // Prepend test banner to HTML
  const testBanner = `
    <div style="background:#f59e0b;color:#1c1c1c;padding:10px 16px;font-family:sans-serif;font-size:13px;font-weight:600;border-radius:4px;margin-bottom:20px;">
      🧪 TEST-E-MAIL — Kampagne: ${campaign.name} — Template: ${template_type}
      ${lead_id ? ` — Lead: ${companyName}` : " — Beispieldaten"}
    </div>
  `;

  const testHtml = testBanner + html;
  const testSubject = `[TEST] ${subject}`;

  const result = await sendEmail({
    to,
    subject: testSubject,
    html: testHtml,
    text: `[TEST E-MAIL]\n\n${text}`,
    "o:tag": ["test", "discovery-test"],
  });

  if (!result) {
    return NextResponse.json({ error: "E-Mail konnte nicht gesendet werden (Mailgun-Fehler)" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: `Test-E-Mail gesendet an ${to}`,
    mailgun_id: result.id,
    preview: { subject: testSubject, company: companyName, city, template_type },
  });
}
