import Link from "next/link";
import {
  Users,
  Database,
  Search,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Mail,
  Send,
  TrendingUp,
  Zap,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoveryCampaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  total_leads_found: number | null;
  areas: unknown;
  categories: string[];
  error_messages: string[] | null;
}

interface OutreachBatch {
  id: string;
  name: string;
  status: string;
  created_at: string;
  total_leads: number;
  sent_count: number;
  replied_count: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days !== 1 ? "en" : ""}`;
}

const campaignStatusConfig: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Ausstehend",
    color: "bg-slate-100 text-slate-700",
    icon: <Clock className="h-3 w-3" />,
  },
  running: {
    label: "Läuft",
    color: "bg-blue-100 text-blue-700",
    icon: <RefreshCw className="h-3 w-3 animate-spin" />,
  },
  completed: {
    label: "Abgeschlossen",
    color: "bg-green-100 text-green-700",
    icon: <CheckCircle className="h-3 w-3" />,
  },
  failed: {
    label: "Fehlgeschlagen",
    color: "bg-red-100 text-red-700",
    icon: <XCircle className="h-3 w-3" />,
  },
  paused: {
    label: "Pausiert",
    color: "bg-yellow-100 text-yellow-700",
    icon: <Clock className="h-3 w-3" />,
  },
};

// ─── Data fetching ─────────────────────────────────────────────────────────

async function getDashboardData() {
  const adminClient = createAdminClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  // Run all queries in parallel
  const [
    usersResult,
    leadsCountResult,
    leadApprovalResult,
    campaignsResult,
    outreachResult,
    recentActivityResult,
  ] = await Promise.allSettled([
    // 1. User stats
    adminClient.auth.admin.listUsers(),

    // 2. Total leads in pool
    adminClient
      .from("solar_lead_mass")
      .select("id", { count: "exact", head: true }),

    // 3. Discovery leads: approved vs pending vs rejected
    adminClient
      .from("discovery_leads")
      .select("approval_status", { count: "exact" }),

    // 4. Discovery campaigns: all recent + running ones
    adminClient
      .from("discovery_campaigns")
      .select(
        "id, name, status, created_at, updated_at, total_leads_found, areas, categories, error_messages"
      )
      .order("updated_at", { ascending: false })
      .limit(20),

    // 5. Outreach batches
    adminClient
      .from("outreach_batches")
      .select("id, name, status, created_at, total_leads, sent_count, replied_count")
      .order("created_at", { ascending: false })
      .limit(10),

    // 6. Recent discovery leads (activity feed)
    adminClient
      .from("discovery_leads")
      .select("id, company_name, category, city, created_at, campaign_id")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  // ── Users ──
  const users =
    usersResult.status === "fulfilled" ? usersResult.value.data.users ?? [] : [];
  const totalUsers = users.length;
  const newUsersLast7Days = users.filter(
    (u) => u.created_at >= sevenDaysAgoISO
  ).length;

  // ── Leads pool ──
  const totalLeadsInPool =
    leadsCountResult.status === "fulfilled"
      ? (leadsCountResult.value.count ?? 0)
      : 0;

  // ── Discovery leads ──
  const discoveryLeads =
    leadApprovalResult.status === "fulfilled"
      ? (leadApprovalResult.value.data ?? [])
      : [];
  const totalDiscoveryLeads = discoveryLeads.length;
  const approvedLeads = discoveryLeads.filter(
    (l) => l.approval_status === "approved"
  ).length;
  const pendingLeads = discoveryLeads.filter(
    (l) => l.approval_status === "pending"
  ).length;
  const rejectedLeads = discoveryLeads.filter(
    (l) => l.approval_status === "rejected"
  ).length;

  // ── Campaigns ──
  const campaigns: DiscoveryCampaign[] =
    campaignsResult.status === "fulfilled"
      ? (campaignsResult.value.data as DiscoveryCampaign[]) ?? []
      : [];

  const runningCampaigns = campaigns.filter(
    (c) => c.status === "running" || c.status === "pending"
  );
  const failedCampaigns = campaigns.filter(
    (c) =>
      c.status === "failed" ||
      (c.error_messages && c.error_messages.length > 0)
  );
  const recentErrors: { campaign: string; message: string; time: string }[] =
    [];
  for (const c of campaigns) {
    if (c.error_messages && c.error_messages.length > 0) {
      for (const msg of c.error_messages.slice(-3)) {
        recentErrors.push({
          campaign: c.name,
          message: msg,
          time: c.updated_at,
        });
      }
    }
  }
  recentErrors.sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  // ── Outreach ──
  const outreachBatches: OutreachBatch[] =
    outreachResult.status === "fulfilled"
      ? (outreachResult.value.data as OutreachBatch[]) ?? []
      : [];
  const totalEmailsSent = outreachBatches.reduce(
    (sum, b) => sum + (b.sent_count ?? 0),
    0
  );
  const totalReplied = outreachBatches.reduce(
    (sum, b) => sum + (b.replied_count ?? 0),
    0
  );
  const globalReplyRate =
    totalEmailsSent > 0
      ? Math.round((totalReplied / totalEmailsSent) * 100)
      : 0;

  // ── Activity feed ──
  const recentLeads =
    recentActivityResult.status === "fulfilled"
      ? recentActivityResult.value.data ?? []
      : [];

  // ── System health ──
  const hasGoogleApiKey = !!process.env.GOOGLE_PLACES_API_KEY;
  const hasSmtpConfig =
    !!process.env.SMTP_HOST || !!process.env.RESEND_API_KEY;
  const dbConnected = campaignsResult.status === "fulfilled";

  return {
    totalUsers,
    newUsersLast7Days,
    totalLeadsInPool,
    totalDiscoveryLeads,
    approvedLeads,
    pendingLeads,
    rejectedLeads,
    campaigns,
    runningCampaigns,
    failedCampaigns,
    recentErrors,
    outreachBatches,
    totalEmailsSent,
    totalReplied,
    globalReplyRate,
    recentLeads,
    hasGoogleApiKey,
    hasSmtpConfig,
    dbConnected,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") {
    redirect("/admin");
  }

  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Admin-Dashboard
          </h1>
          <p className="text-slate-600">
            Systemübersicht · {new Date().toLocaleDateString("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.runningCampaigns.length > 0 && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
              <Activity className="h-3.5 w-3.5 animate-pulse" />
              {data.runningCampaigns.length} Kampagne{data.runningCampaigns.length !== 1 ? "n" : ""} aktiv
            </span>
          )}
        </div>
      </div>

      {/* ── System Health ── */}
      <div className="grid gap-3 md:grid-cols-3">
        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
            data.dbConnected
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          {data.dbConnected ? (
            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-medium ${data.dbConnected ? "text-green-900" : "text-red-900"}`}>
              Datenbank
            </p>
            <p className={`text-xs ${data.dbConnected ? "text-green-700" : "text-red-700"}`}>
              {data.dbConnected ? "Verbunden" : "Nicht erreichbar"}
            </p>
          </div>
        </div>

        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
            data.hasGoogleApiKey
              ? "bg-green-50 border-green-200"
              : "bg-yellow-50 border-yellow-200"
          }`}
        >
          {data.hasGoogleApiKey ? (
            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-medium ${data.hasGoogleApiKey ? "text-green-900" : "text-yellow-900"}`}>
              Google Places API
            </p>
            <p className={`text-xs ${data.hasGoogleApiKey ? "text-green-700" : "text-yellow-700"}`}>
              {data.hasGoogleApiKey ? "API-Key konfiguriert" : "API-Key fehlt"}
            </p>
          </div>
        </div>

        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
            data.hasSmtpConfig
              ? "bg-green-50 border-green-200"
              : "bg-yellow-50 border-yellow-200"
          }`}
        >
          {data.hasSmtpConfig ? (
            <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-medium ${data.hasSmtpConfig ? "text-green-900" : "text-yellow-900"}`}>
              E-Mail (SMTP)
            </p>
            <p className={`text-xs ${data.hasSmtpConfig ? "text-green-700" : "text-yellow-700"}`}>
              {data.hasSmtpConfig ? "Konfiguriert" : "Nicht konfiguriert"}
            </p>
          </div>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Nutzer gesamt
            </CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{data.totalUsers}</div>
            {data.newUsersLast7Days > 0 && (
              <p className="text-xs text-green-600 mt-1">
                +{data.newUsersLast7Days} diese Woche
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Lead-Pool
            </CardTitle>
            <Database className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{data.totalLeadsInPool}</div>
            <p className="text-xs text-slate-500 mt-1">Leads in solar_lead_mass</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Discovery-Leads
            </CardTitle>
            <Search className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{data.totalDiscoveryLeads}</div>
            <div className="flex gap-2 mt-1">
              <span className="text-xs text-green-600">{data.approvedLeads} ✓</span>
              <span className="text-xs text-slate-400">{data.pendingLeads} offen</span>
              <span className="text-xs text-red-500">{data.rejectedLeads} ✗</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              E-Mails versendet
            </CardTitle>
            <Send className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{data.totalEmailsSent}</div>
            <p className="text-xs text-slate-500 mt-1">
              {data.globalReplyRate}% Reply-Rate · {data.totalReplied} Antworten
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Running / Recent Campaigns ── */}
        <Card className="bg-white border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Discovery-Kampagnen
            </CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-slate-500 hover:text-slate-900">
              <Link href="/admin/discovery">
                Alle anzeigen <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data.campaigns.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-slate-500">
                Noch keine Kampagnen vorhanden
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.campaigns.slice(0, 8).map((c) => {
                  const cfg = campaignStatusConfig[c.status] ?? {
                    label: c.status,
                    color: "bg-slate-100 text-slate-700",
                    icon: null,
                  };
                  const hasErrors =
                    c.error_messages && c.error_messages.length > 0;
                  return (
                    <Link
                      key={c.id}
                      href={`/admin/discovery/${c.id}`}
                      className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {c.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {timeAgo(c.updated_at)}
                          {c.total_leads_found != null &&
                            ` · ${c.total_leads_found} Leads`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {hasErrors && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        )}
                        <Badge
                          variant="secondary"
                          className={`text-xs flex items-center gap-1 ${cfg.color}`}
                        >
                          {cfg.icon}
                          {cfg.label}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right column: Errors + Outreach ── */}
        <div className="space-y-6">
          {/* ── Errors ── */}
          <Card className="bg-white border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Fehlerprotokoll
              </CardTitle>
              {data.recentErrors.length > 0 && (
                <Badge variant="secondary" className="bg-red-50 text-red-700 text-xs">
                  {data.recentErrors.length} Fehler
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              {data.recentErrors.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  Keine Fehler in den letzten Kampagnen
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {data.recentErrors.slice(0, 10).map((err, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-red-50 border border-red-100 px-3 py-2"
                    >
                      <p className="text-xs font-medium text-red-800 truncate">
                        {err.campaign}
                      </p>
                      <p className="text-xs text-red-700 mt-0.5 line-clamp-2">
                        {err.message}
                      </p>
                      <p className="text-xs text-red-400 mt-1">
                        {timeAgo(err.time)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Outreach Batches ── */}
          <Card className="bg-white border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Outreach-Batches
              </CardTitle>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-slate-500 hover:text-slate-900">
                <Link href="/admin/outreach">
                  Alle <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {data.outreachBatches.length === 0 ? (
                <div className="px-6 py-6 text-center text-sm text-slate-500">
                  Noch keine Batches
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.outreachBatches.slice(0, 4).map((b) => {
                    const rate =
                      b.sent_count > 0
                        ? Math.round((b.replied_count / b.sent_count) * 100)
                        : 0;
                    return (
                      <Link
                        key={b.id}
                        href={`/admin/outreach/${b.id}`}
                        className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {b.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {b.sent_count} gesendet · {b.replied_count} Antworten
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`text-sm font-semibold ${
                              rate >= 10
                                ? "text-green-600"
                                : rate >= 5
                                ? "text-yellow-600"
                                : "text-slate-500"
                            }`}
                          >
                            {rate}%
                          </p>
                          <p className="text-xs text-slate-400">Reply</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Bottom Row: Activity + Quick Actions ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Recent Activity ── */}
        <div className="lg:col-span-2">
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#B2D082]" />
                Kürzlich entdeckte Leads
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.recentLeads.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-slate-500">
                  Noch keine Leads entdeckt
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="flex items-center gap-3 px-6 py-2.5"
                    >
                      <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <Database className="h-3.5 w-3.5 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {lead.company_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {lead.city} · {lead.category}
                        </p>
                      </div>
                      <p className="text-xs text-slate-400 shrink-0">
                        {timeAgo(lead.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Quick Actions ── */}
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Schnellzugriff
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              asChild
              className="w-full justify-start text-[#1F3D2E] font-semibold"
              style={{ backgroundColor: "#B2D082" }}
            >
              <Link href="/admin/discovery/new">
                <Search className="mr-2 h-4 w-4" />
                Neue Kampagne starten
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full justify-start border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Link href="/admin/discovery">
                <Activity className="mr-2 h-4 w-4" />
                Alle Kampagnen
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full justify-start border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Link href="/admin/outreach/new">
                <Mail className="mr-2 h-4 w-4" />
                Neuen Batch erstellen
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full justify-start border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Link href="/admin/outreach">
                <TrendingUp className="mr-2 h-4 w-4" />
                Outreach-Übersicht
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full justify-start border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Link href="/admin/users">
                <Users className="mr-2 h-4 w-4" />
                Nutzerverwaltung
              </Link>
            </Button>

            {/* Stats summary */}
            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-700">Gesamt-Übersicht</p>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Kampagnen gesamt</span>
                <span className="font-medium text-slate-900">{data.campaigns.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Davon laufend</span>
                <span className={`font-medium ${data.runningCampaigns.length > 0 ? "text-blue-700" : "text-slate-900"}`}>
                  {data.runningCampaigns.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Mit Fehlern</span>
                <span className={`font-medium ${data.failedCampaigns.length > 0 ? "text-red-600" : "text-slate-900"}`}>
                  {data.failedCampaigns.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Pending Reviews</span>
                <span className={`font-medium ${data.pendingLeads > 0 ? "text-amber-700" : "text-slate-900"}`}>
                  {data.pendingLeads}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
