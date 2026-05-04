import { redirect } from "next/navigation";
import Link from "next/link";
import { Inbox, User, BarChart3, Crown, Mail, LayoutGrid } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LogoutButton } from "@/components/dashboard/logout-button";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = profile?.role as string | undefined;
  const allowed = ["reply_specialist", "team_lead", "admin"];
  if (!role || !allowed.includes(role)) {
    redirect("/dashboard");
  }

  const isLead = role === "team_lead" || role === "admin";

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200">
          <p className="text-xs uppercase tracking-wide text-slate-400">Reply-Team</p>
          <p className="font-semibold text-slate-900 truncate" title={user.email ?? ""}>
            {user.email}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            {role === "admin" && <><Crown className="h-3 w-3 text-amber-500" /> Admin</>}
            {role === "team_lead" && <><Crown className="h-3 w-3 text-purple-500" /> Team-Lead</>}
            {role === "reply_specialist" && <>Specialist</>}
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1 text-sm">
          <Link
            href="/team/inbox"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
          >
            <Inbox className="h-4 w-4" /> Inbox
          </Link>
          <Link
            href="/team/board"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
          >
            <LayoutGrid className="h-4 w-4" /> Kanban-Board
          </Link>
          <Link
            href="/team/me"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
          >
            <User className="h-4 w-4" /> Meine Stats
          </Link>
          {isLead && (
            <>
              <div className="pt-3 mt-3 border-t border-slate-200">
                <p className="px-3 mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                  Team-Lead
                </p>
                <Link
                  href="/admin/reply-management"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
                >
                  <BarChart3 className="h-4 w-4" /> Reply-Management
                </Link>
                <Link
                  href="/admin/outreach/replies"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
                >
                  <Mail className="h-4 w-4" /> Klassische Inbox
                </Link>
              </div>
            </>
          )}
          {role === "admin" && (
            <div className="pt-3 mt-3 border-t border-slate-200">
              <Link
                href="/admin"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
              >
                <Crown className="h-4 w-4" /> Admin-Bereich
              </Link>
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-slate-200">
          <LogoutButton />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
