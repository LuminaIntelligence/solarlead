import Link from "next/link";
import { Download } from "lucide-react";
import { getLeads } from "@/lib/actions/leads";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadsFilters } from "@/components/leads/leads-filters";
import { BulkContactsButton } from "@/components/leads/bulk-contacts-button";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    category?: string;
    city?: string;
    minScore?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
}) {
  const params = await searchParams;

  const leads = await getLeads({
    status: params.status || undefined,
    category: params.category || undefined,
    city: params.city || undefined,
    minScore: params.minScore ? Number(params.minScore) : undefined,
    search: params.search || undefined,
    sortBy: params.sortBy || undefined,
    sortOrder: (params.sortOrder as "asc" | "desc") || undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alle Leads</h1>
          <p className="text-muted-foreground">
            {leads.length} {leads.length === 1 ? "Lead" : "Leads"} gefunden
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BulkContactsButton />
          <Link
            href="/dashboard/import?tab=export"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Exportieren
          </Link>
        </div>
      </div>

      <LeadsFilters />
      <LeadsTable leads={leads} />
    </div>
  );
}
