/**
 * POST /api/admin/leads/linkedin-backfill
 *
 * Bulk-Suche LinkedIn-URLs via Google CSE. Verarbeitet einen Chunk Leads
 * synchron und gibt Resultate zurück. UI klickt mehrfach für Folge-Chunks.
 *
 * Body:
 *   {
 *     min_score?: number   (default 80)
 *     max_score?: number   (default 100)
 *     limit?: number       (default 50, max 100)
 *     auto_apply_threshold?: number  (default 0.7 — ≥0.7 wird auto-applied)
 *   }
 *
 * Algorithmus pro Lead:
 *   1. Prüfe lead_contacts für diesen Lead:
 *      - Personenkontakt (Vor+Nachname, keine generische Mail) ohne LinkedIn?
 *        → Modus A
 *      - Sonst (nur generischer Kontakt oder gar keiner)
 *        → Modus B (entdecke einen neuen Entscheidungsträger)
 *   2. CSE-Suche
 *   3. Confidence ≥ threshold → automatisch übernehmen
 *      Confidence 0.4..threshold → Review-Queue
 *      Confidence < 0.4 oder kein Treffer → markiert als "no_result"
 *   4. solar_lead_mass.linkedin_search_at gesetzt — Lead wird nicht nochmal angefragt
 */

import { NextResponse } from "next/server";
import { requireAdminAndOrigin } from "@/lib/auth/admin-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findProfileForPerson,
  findProfileAtCompany,
  isGenericEmail,
  isPersonContact,
  isPersonalLinkedInUrl,
  type FoundProfile,
} from "@/lib/linkedin/finder";
import { isAnySearchProviderConfigured, activeProvider } from "@/lib/providers/search/searchProvider";

// Längere maxDuration — bei 20 Leads × 2s SerpAPI ≈ 40s normal, aber
// einzelne Calls können länger brauchen.
export const maxDuration = 120;

interface BackfillResult {
  lead_id: string;
  company_name: string;
  mode: "A" | "B" | null;
  status: "auto_applied" | "review" | "no_result" | "quota_exceeded" | "error" | "skipped";
  message?: string;
  profile?: FoundProfile | null;
  contact_id?: string;  // updated/created contact
}

export async function POST(req: Request) {
  const gate = await requireAdminAndOrigin(req);
  if (gate.error) return gate.error;

  if (!isAnySearchProviderConfigured()) {
    return NextResponse.json(
      {
        error:
          "Kein Such-Provider konfiguriert. SERPAPI_KEY (bevorzugt) oder GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID in .env.local setzen.",
      },
      { status: 503 }
    );
  }
  const provider = activeProvider();

  const body = await req.json().catch(() => ({}));
  const minScore = Math.max(0, Math.min(100, Number(body.min_score ?? 80)));
  const maxScore = Math.max(0, Math.min(100, Number(body.max_score ?? 100)));
  const limit = Math.max(1, Math.min(100, Number(body.limit ?? 50)));
  const autoThreshold = Math.max(0.4, Math.min(1, Number(body.auto_apply_threshold ?? 0.7)));

  const sb = createAdminClient();
  const results: BackfillResult[] = [];
  let apiCalls = 0;

  // 1) Leads im Score-Range die noch nicht durchsucht wurden
  const { data: leads, error: leadsErr } = await sb
    .from("solar_lead_mass")
    .select("id, company_name, city, total_score, linkedin_search_at")
    .gte("total_score", minScore)
    .lt("total_score", maxScore + 1)
    .is("linkedin_search_at", null)
    .order("total_score", { ascending: false })
    .limit(limit);

  if (leadsErr) {
    return NextResponse.json({ error: leadsErr.message }, { status: 500 });
  }
  if (!leads || leads.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      results: [],
      remaining: 0,
      api_calls: 0,
      message: "Keine offenen Leads im Score-Range gefunden.",
    });
  }

  console.log(`[LinkedIn-Backfill] Start: ${leads.length} Leads, provider=${provider}, threshold=${autoThreshold}`);

  // 2) Pro Lead: Kontakte laden, Modus entscheiden, suchen, anwenden
  for (const lead of leads) {
    const result: BackfillResult = {
      lead_id: lead.id as string,
      company_name: lead.company_name as string,
      mode: null,
      status: "no_result",
    };

    try {
      // Kontakte holen
      const { data: contacts } = await sb
        .from("lead_contacts")
        .select("id, name, email, title, linkedin_url, is_primary")
        .eq("lead_id", lead.id);
      const cs = contacts ?? [];

      // Hat schon eine Personen-LinkedIn-URL? Dann nichts zu tun.
      const hasPersonalLink = cs.some(
        (c) => c.linkedin_url && isPersonalLinkedInUrl(c.linkedin_url)
      );
      if (hasPersonalLink) {
        result.status = "skipped";
        result.message = "hat schon persönliches LinkedIn";
        results.push(result);
        await sb
          .from("solar_lead_mass")
          .update({
            linkedin_search_at: new Date().toISOString(),
            linkedin_search_result: "matched",
          })
          .eq("id", lead.id);
        continue;
      }

      // Modus A: existierender Personenkontakt ohne LinkedIn?
      const personContact = cs.find((c) => isPersonContact(c) && !c.linkedin_url);

      // Modus B: nur generische Kontakte oder gar keine
      const allGenericOrEmpty =
        cs.length === 0 ||
        cs.every((c) => !isPersonContact(c));

      if (personContact) {
        result.mode = "A";
        const nameParts = personContact.name!.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(" ");
        const finder = await findProfileForPerson({
          firstName,
          lastName,
          company: lead.company_name as string,
        });
        apiCalls++;

        if (finder.quotaExceeded) {
          result.status = "quota_exceeded";
          result.message = finder.error;
          results.push(result);
          break; // weitere Calls zwecklos
        }
        if (!finder.ok) {
          result.status = "error";
          result.message = finder.error;
          results.push(result);
          continue;
        }

        const p = finder.profile;
        if (!p || p.confidence < 0.4) {
          result.status = "no_result";
          result.profile = p;
        } else if (p.confidence >= autoThreshold) {
          // Auto-Apply: existierenden Kontakt updaten
          await sb
            .from("lead_contacts")
            .update({
              linkedin_url: p.url,
              linkedin_search_at: new Date().toISOString(),
              linkedin_search_confidence: p.confidence,
              linkedin_search_query: p.query,
              discovered_via: "google_cse",
            })
            .eq("id", personContact.id);
          result.status = "auto_applied";
          result.profile = p;
          result.contact_id = personContact.id as string;
        } else {
          // Review-Queue: speichere als Confidence-Vorschlag aber NICHT URL setzen
          await sb
            .from("lead_contacts")
            .update({
              linkedin_search_at: new Date().toISOString(),
              linkedin_search_confidence: p.confidence,
              linkedin_search_query: p.query,
            })
            .eq("id", personContact.id);
          result.status = "review";
          result.profile = p;
          result.contact_id = personContact.id as string;
        }
      } else if (allGenericOrEmpty) {
        result.mode = "B";
        const finder = await findProfileAtCompany({
          company: lead.company_name as string,
        });
        apiCalls++;

        if (finder.quotaExceeded) {
          result.status = "quota_exceeded";
          result.message = finder.error;
          results.push(result);
          break;
        }
        if (!finder.ok) {
          result.status = "error";
          result.message = finder.error;
          results.push(result);
          continue;
        }

        const p = finder.profile;
        if (!p || !p.name || p.confidence < 0.4) {
          result.status = "no_result";
          result.profile = p;
        } else if (p.confidence >= autoThreshold) {
          // Auto-Apply: NEUEN Kontakt anlegen (Person aus Snippet)
          const { data: newContact } = await sb
            .from("lead_contacts")
            .insert({
              lead_id: lead.id,
              user_id: gate.user!.id,
              name: p.name,
              title: p.title,
              linkedin_url: p.url,
              is_primary: true, // Person wichtiger als info@
              source: "google_cse",
              discovered_via: "google_cse",
              linkedin_search_at: new Date().toISOString(),
              linkedin_search_confidence: p.confidence,
              linkedin_search_query: p.query,
            })
            .select("id")
            .single();
          result.status = "auto_applied";
          result.profile = p;
          result.contact_id = (newContact?.id as string) ?? undefined;
        } else {
          // Review-Queue: speichere Vorschlag in einer leichten "pending"-Form
          // → wir legen einen lead_contact mit linkedin_url=NULL aber
          //   discovery-Spalten gefüllt an, damit der User in der UI bestätigen kann
          const { data: newContact } = await sb
            .from("lead_contacts")
            .insert({
              lead_id: lead.id,
              user_id: gate.user!.id,
              name: p.name,
              title: p.title,
              linkedin_url: null, // erst bei Bestätigung
              is_primary: false,
              source: "google_cse_review",
              discovered_via: "google_cse",
              linkedin_search_at: new Date().toISOString(),
              linkedin_search_confidence: p.confidence,
              linkedin_search_query: p.query,
            })
            .select("id")
            .single();
          result.status = "review";
          result.profile = p;
          result.contact_id = (newContact?.id as string) ?? undefined;
        }
      } else {
        // Lead hat schon einen Personen-Kontakt MIT LinkedIn (Edge-Case, oben gefiltert)
        result.status = "skipped";
        result.message = "kein passender Modus";
      }

      // Lead als durchsucht markieren
      const finalLeadResult =
        result.status === "auto_applied"
          ? "matched"
          : result.status === "review"
          ? "review"
          : result.status === "no_result"
          ? "no_result"
          : null;
      if (finalLeadResult) {
        await sb
          .from("solar_lead_mass")
          .update({
            linkedin_search_at: new Date().toISOString(),
            linkedin_search_result: finalLeadResult,
          })
          .eq("id", lead.id);
      }
    } catch (e) {
      result.status = "error";
      result.message = e instanceof Error ? e.message : String(e);
    }

    console.log(`[LinkedIn-Backfill] ${result.company_name}: mode=${result.mode} status=${result.status}${result.profile ? ` confidence=${result.profile.confidence.toFixed(2)}` : ""}${result.message ? ` msg=${result.message.slice(0, 80)}` : ""}`);
    results.push(result);
  }

  console.log(`[LinkedIn-Backfill] Done: ${results.length} processed, ${apiCalls} API calls`);

  // API-Calls in daily_api_usage tracken — pro Provider getrennt
  if (apiCalls > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const providerKey = provider ?? "unknown";
    const { data: existing } = await sb
      .from("daily_api_usage")
      .select("id, calls, estimated_cost_eur")
      .eq("date", today)
      .eq("provider", providerKey)
      .maybeSingle();

    // Cost-Schätzung pro Provider:
    //   google_cse: $0.005 / Call (~5€ / 1.000)
    //   serpapi:    $0.01 / Call ($50 / 5.000)
    const costPerCall = provider === "serpapi" ? 0.01 : 0.005;
    const additional = apiCalls * costPerCall;

    if (existing) {
      await sb
        .from("daily_api_usage")
        .update({
          calls: (existing.calls ?? 0) + apiCalls,
          estimated_cost_eur:
            (Number(existing.estimated_cost_eur) || 0) + additional,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await sb.from("daily_api_usage").insert({
        date: today,
        provider: providerKey,
        calls: apiCalls,
        estimated_cost_eur: additional,
      });
    }
  }

  // Verbleibend (für UI-Progress)
  const { count: remaining } = await sb
    .from("solar_lead_mass")
    .select("id", { count: "exact", head: true })
    .gte("total_score", minScore)
    .lt("total_score", maxScore + 1)
    .is("linkedin_search_at", null);

  return NextResponse.json({
    ok: true,
    provider,
    processed: results.length,
    api_calls: apiCalls,
    results,
    remaining: remaining ?? 0,
    summary: {
      auto_applied: results.filter((r) => r.status === "auto_applied").length,
      review: results.filter((r) => r.status === "review").length,
      no_result: results.filter((r) => r.status === "no_result").length,
      errors: results.filter((r) => r.status === "error").length,
      quota_exceeded: results.filter((r) => r.status === "quota_exceeded").length,
    },
  });
}
