import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  if (user.user_metadata?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main content area */}
      <div className="pl-64">
        {/* GreenScout accent line */}
        <div className="h-0.5" style={{ backgroundColor: "#B2D082" }} />

        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950 px-8">
          <span className="text-sm font-medium" style={{ color: "#B2D082" }}>
            Admin-Bereich
          </span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">{user.email}</span>
            <AdminLogoutButton />
          </div>
        </header>

        {/* Page content */}
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
