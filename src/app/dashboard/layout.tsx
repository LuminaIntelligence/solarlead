import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { LogoutButton } from "@/components/dashboard/logout-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Read role from user_settings (DB-backed, since 20260503). No more
  // user_metadata.role — that was user-modifiable and removed for security.
  const { data: settings } = await supabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const role = (settings?.role as string | undefined) ?? "user";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar */}
      <SidebarNav role={role} />

      {/* Main content area */}
      <div className="pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-end gap-4 border-b border-slate-200 bg-white px-8">
          <span className="text-sm text-slate-600">{user.email}</span>
          <LogoutButton />
        </header>

        {/* Page content */}
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
