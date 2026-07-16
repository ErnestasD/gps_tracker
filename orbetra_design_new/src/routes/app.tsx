import * as React from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminThemeProvider } from "@/lib/admin-theme";
import { NotificationsProvider } from "@/lib/admin-notifications";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { Toaster } from "@/components/ui/sonner";
import { X } from "lucide-react";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Orbetra Admin — GPS parkas" },
      { name: "description", content: "Orbetra parkas ir įrenginių valdymas." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  return (
    <AdminThemeProvider>
      <NotificationsProvider>
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <div className="sticky top-0 h-screen">
            <AdminSidebar />
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 h-full w-64">
              <div className="relative h-full">
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Uždaryti"
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md"
                  style={{ color: "var(--admin-ink)", background: "var(--admin-surface)" }}
                >
                  <X className="h-4 w-4" />
                </button>
                <AdminSidebar onNavigate={() => setMobileOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar onOpenSidebar={() => setMobileOpen(true)} />
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
      </NotificationsProvider>
    </AdminThemeProvider>
  );
}
