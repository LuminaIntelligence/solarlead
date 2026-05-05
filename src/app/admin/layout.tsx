import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";

export default async function AdminLayout({
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

  // DB-backed role check — user_metadata.role is user-writable and untrusted.
  // The middleware already gates this path, but we double-check at the layout
  // boundary because Next.js doesn't guarantee middleware runs for every render
  // (e.g. partial prerendering, edge cases with caching).
  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main content area */}
      <div className="pl-64">
        {/* GreenScout accent line */}
        <div className="h-0.5" style={{ backgroundColor: "#B2D082" }} />

        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
          <span className="text-sm font-semibold" style={{ color: "#1F3D2E" }}>
            Admin-Bereich
          </span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">{user.email}</span>
            <AdminLogoutButton />
          </div>
        </header>

        {/* Page content */}
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
