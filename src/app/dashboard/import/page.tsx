"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Papa from "papaparse";
import {
  Upload,
  Download,
  FileSpreadsheet,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { saveLeads, getLeads } from "@/lib/actions/leads";
import { calculateScore } from "@/lib/scoring";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Lead, LeadStatus } from "@/types/database";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEAD_FIELDS = [
  { key: "company_name", label: "Firmenname", required: true },
  { key: "category", label: "Kategorie", required: false },
  { key: "website", label: "Website", required: false },
  { key: "phone", label: "Telefon", required: false },
  { key: "email", label: "E-Mail", required: false },
  { key: "address", label: "Adresse", required: false },
  { key: "city", label: "Stadt", required: false },
  { key: "postal_code", label: "PLZ", required: false },
  { key: "country", label: "Land", required: false },
  { key: "latitude", label: "Breitengrad", required: false },
  { key: "longitude", label: "Längengrad", required: false },
] as const;

type LeadFieldKey = (typeof LEAD_FIELDS)[number]["key"];

const EXPORT_FIELDS: (keyof Lead)[] = [
  "company_name",
  "category",
  "website",
  "phone",
  "email",
  "address",
  "city",
  "postal_code",
  "country",
  "latitude",
  "longitude",
  "business_score",
  "electricity_score",
  "solar_score",
  "outreach_score",
  "total_score",
  "status",
  "notes",
];

const STATUS_OPTIONS: { value: LeadStatus | ""; label: string }[] = [
  { value: "", label: "Alle Status" },
  { value: "new", label: "Neu" },
  { value: "reviewed", label: "Geprüft" },
  { value: "contacted", label: "Kontaktiert" },
  { value: "qualified", label: "Qualifiziert" },
  { value: "rejected", label: "Abgelehnt" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessMapping(headers: string[]): Record<string, LeadFieldKey | ""> {
  const mapping: Record<string, LeadFieldKey | ""> = {};
  const fieldKeys = LEAD_FIELDS.map((f) => f.key);

  for (const header of headers) {
    const normalised = header
      .toLowerCase()
      .replace(/[\s\-/]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

    // Exact match
    if (fieldKeys.includes(normalised as LeadFieldKey)) {
      mapping[header] = normalised as LeadFieldKey;
      continue;
    }

    // Common aliases
    const aliases: Record<string, LeadFieldKey> = {
      name: "company_name",
      company: "company_name",
      firma: "company_name",
      firmenname: "company_name",
      unternehmensname: "company_name",
      kategorie: "category",
      type: "category",
      branche: "category",
      webseite: "website",
      url: "website",
      homepage: "website",
      telefon: "phone",
      telephone: "phone",
      tel: "phone",
      mail: "email",
      e_mail: "email",
      adresse: "address",
      strasse: "address",
      street: "address",
      stadt: "city",
      ort: "city",
      plz: "postal_code",
      zip: "postal_code",
      zip_code: "postal_code",
      postleitzahl: "postal_code",
      land: "country",
      lat: "latitude",
      lng: "longitude",
      lon: "longitude",
    };

    if (aliases[normalised]) {
      mapping[header] = aliases[normalised];
    } else {
      mapping[header] = "";
    }
  }

  return mapping;
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function ImportExportPage() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") === "export" ? "export" : "import";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import / Export</h1>
        <p className="text-muted-foreground">
          Leads aus CSV importieren oder Daten exportieren
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="import" className="gap-2">
            <Upload className="h-4 w-4" />
            Import
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import">
          <ImportTab />
        </TabsContent>

        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import Tab
// ---------------------------------------------------------------------------

type ImportState =
  | "idle"
  | "file_selected"
  | "previewing"
  | "ready"
  | "importing"
  | "done"
  | "error";

function ImportTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, LeadFieldKey | "">>({});
  const [progress, setProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // ---- File handling ----

  const handleFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage("Bitte wählen Sie eine CSV-Datei aus.");
      setState("error");
      return;
    }
    setFile(f);
    setState("file_selected");
    setErrorMessage("");
    setImportedCount(0);
    setSkippedCount(0);
    setProgress(0);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    },
    [handleFile]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(true);
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
    },
    []
  );

  const clearFile = useCallback(() => {
    setFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setPreviewRows([]);
    setMapping({});
    setState("idle");
    setErrorMessage("");
    setImportedCount(0);
    setSkippedCount(0);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ---- Preview ----

  const handlePreview = useCallback(() => {
    if (!file) return;
    setState("previewing");

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });

      if (result.errors.length > 0 && result.data.length === 0) {
        setErrorMessage(
          `CSV parse error: ${result.errors[0]?.message || "Unknown error"}`
        );
        setState("error");
        return;
      }

      const headers = result.meta.fields || [];
      setCsvHeaders(headers);
      setCsvRows(result.data);
      setPreviewRows(result.data.slice(0, 5));
      setMapping(guessMapping(headers));
      setState("ready");
    };
    reader.onerror = () => {
      setErrorMessage("Datei konnte nicht gelesen werden.");
      setState("error");
    };
    reader.readAsText(file);
  }, [file]);

  // ---- Import ----

  const handleImport = useCallback(async () => {
    // Validate required mapping
    const companyMapped = Object.values(mapping).includes("company_name");
    if (!companyMapped) {
      setErrorMessage("Sie müssen mindestens das Feld Firmenname zuordnen.");
      return;
    }

    setState("importing");
    setProgress(10);
    setErrorMessage("");

    try {
      // Build reverse mapping: leadField -> csvHeader
      const reverseMap: Partial<Record<LeadFieldKey, string>> = {};
      for (const [csvHeader, leadField] of Object.entries(mapping)) {
        if (leadField) {
          reverseMap[leadField] = csvHeader;
        }
      }

      // Fetch existing leads to check for duplicates by company_name + city
      setProgress(20);
      const existingLeads = await getLeads();
      const existingSet = new Set(
        existingLeads.map(
          (l) => `${l.company_name.toLowerCase()}||${(l.city || "").toLowerCase()}`
        )
      );

      setProgress(30);

      // Build leads
      const leadsToImport: Omit<
        Lead,
        "id" | "created_at" | "updated_at" | "user_id"
      >[] = [];
      let skipped = 0;

      for (const row of csvRows) {
        const getValue = (field: LeadFieldKey): string =>
          (reverseMap[field] ? row[reverseMap[field]!] : "") || "";

        const companyName = getValue("company_name").trim();
        if (!companyName) {
          skipped++;
          continue;
        }

        const city = getValue("city").trim();
        const dedupKey = `${companyName.toLowerCase()}||${city.toLowerCase()}`;
        if (existingSet.has(dedupKey)) {
          skipped++;
          continue;
        }

        // Also deduplicate within the current import batch
        existingSet.add(dedupKey);

        const category = getValue("category") || "other";
        const website = getValue("website") || null;
        const phone = getValue("phone") || null;
        const email = getValue("email") || null;
        const lat = parseFloat(getValue("latitude")) || null;
        const lng = parseFloat(getValue("longitude")) || null;

        // Calculate scores
        const scoring = calculateScore({
          category,
          hasWebsite: !!website,
          hasPhone: !!phone,
          hasEmail: !!email,
        });

        leadsToImport.push({
          company_name: companyName,
          category,
          website,
          phone,
          email,
          address: getValue("address") || "",
          city,
          postal_code: getValue("postal_code") || null,
          country: getValue("country") || "DE",
          latitude: lat,
          longitude: lng,
          place_id: null,
          source: "csv_import",
          business_score: scoring.business_score,
          electricity_score: scoring.electricity_score,
          solar_score: scoring.solar_score,
          outreach_score: scoring.outreach_score,
          total_score: scoring.total_score,
          status: "new",
          notes: null,
          linkedin_url: null,
        });
      }

      setProgress(60);

      // Save in batches
      let totalImported = 0;
      const batchSize = 50;

      for (let i = 0; i < leadsToImport.length; i += batchSize) {
        const batch = leadsToImport.slice(i, i + batchSize);
        const saved = await saveLeads(batch);
        totalImported += saved;

        const pct = 60 + Math.round(((i + batch.length) / leadsToImport.length) * 35);
        setProgress(Math.min(95, pct));
      }

      setProgress(100);
      setImportedCount(totalImported);
      setSkippedCount(skipped + (leadsToImport.length - totalImported));
      setState("done");
    } catch (err) {
      console.error("Import error:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Ein unerwarteter Fehler ist aufgetreten."
      );
      setState("error");
    }
  }, [mapping, csvRows]);

  // ---- Column mapping update ----

  const updateMapping = useCallback(
    (csvHeader: string, value: string) => {
      setMapping((prev) => ({
        ...prev,
        [csvHeader]: value as LeadFieldKey | "",
      }));
    },
    []
  );

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <Card>
        <CardContent className="pt-6">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center
              cursor-pointer transition-colors
              ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }
            `}
          >
            <FileSpreadsheet className="mb-4 h-12 w-12 text-muted-foreground" />
            {file ? (
              <div className="flex items-center gap-2">
                <span className="font-medium">{file.name}</span>
                <span className="text-sm text-muted-foreground">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="ml-2 rounded-full p-1 hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <p className="font-medium">
                  CSV-Datei hierher ziehen oder klicken zum Auswählen
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Unterstützt .csv-Dateien mit Kopfzeile
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview button */}
      {state === "file_selected" && (
        <div className="flex justify-end">
          <Button onClick={handlePreview}>CSV-Vorschau</Button>
        </div>
      )}

      {/* Loading state */}
      {state === "previewing" && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            CSV wird verarbeitet...
          </CardContent>
        </Card>
      )}

      {/* Preview table */}
      {(state === "ready" || state === "importing" || state === "done") &&
        previewRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Vorschau ({csvRows.length} Zeilen gesamt, erste{" "}
                {previewRows.length} angezeigt)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {csvHeaders.map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-3 py-2 text-left font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {csvHeaders.map((h) => (
                          <td
                            key={h}
                            className="max-w-[200px] truncate whitespace-nowrap px-3 py-2"
                          >
                            {row[h] || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Column mapping */}
      {(state === "ready" || state === "importing" || state === "done") &&
        csvHeaders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Spalten-Zuordnung</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {csvHeaders.map((header) => (
                  <div key={header} className="space-y-1.5">
                    <Label className="text-sm text-muted-foreground">
                      {header}
                    </Label>
                    <Select
                      value={mapping[header] || "_unmapped"}
                      onValueChange={(val) =>
                        updateMapping(header, val === "_unmapped" ? "" : val)
                      }
                      disabled={state === "importing" || state === "done"}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_unmapped">-- Überspringen --</SelectItem>
                        {LEAD_FIELDS.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {!Object.values(mapping).includes("company_name") && (
                <p className="mt-3 text-sm text-destructive">
                  Firmenname-Zuordnung ist erforderlich.
                </p>
              )}
            </CardContent>
          </Card>
        )}

      {/* Import progress */}
      {state === "importing" && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Leads werden importiert...</span>
            </div>
            <Progress value={progress} />
          </CardContent>
        </Card>
      )}

      {/* Import button */}
      {state === "ready" && (
        <div className="flex justify-end">
          <Button
            onClick={handleImport}
            disabled={!Object.values(mapping).includes("company_name")}
          >
            <Upload className="mr-2 h-4 w-4" />
            {csvRows.length} Leads importieren
          </Button>
        </div>
      )}

      {/* Results */}
      {state === "done" && (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
          <CardContent className="flex items-start gap-3 pt-6">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                Import abgeschlossen
              </p>
              <p className="text-sm text-green-700 dark:text-green-300">
                {importedCount} Lead{importedCount !== 1 ? "s" : ""} erfolgreich
                importiert.{" "}
                {skippedCount > 0 && (
                  <span>
                    {skippedCount} übersprungen (Duplikate oder fehlende Daten).
                  </span>
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={clearFile}
              >
                Weitere Datei importieren
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {state === "error" && errorMessage && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">
                Importfehler
              </p>
              <p className="text-sm text-red-700 dark:text-red-300">
                {errorMessage}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={clearFile}
              >
                Erneut versuchen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Tab
// ---------------------------------------------------------------------------

function ExportTab() {
  const [status, setStatus] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [minScore, setMinScore] = useState<string>("");
  const [maxScore, setMaxScore] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState<number | null>(null);

  const doExport = useCallback(
    async (useFilters: boolean) => {
      setExporting(true);
      setExportCount(null);

      try {
        const filters = useFilters
          ? {
              status: status || undefined,
              category: category || undefined,
              city: city || undefined,
              minScore: minScore ? Number(minScore) : undefined,
              maxScore: maxScore ? Number(maxScore) : undefined,
            }
          : undefined;

        const leads = await getLeads(filters);

        if (leads.length === 0) {
          setExportCount(0);
          setExporting(false);
          return;
        }

        const exportData = leads.map((lead) => {
          const row: Record<string, unknown> = {};
          for (const field of EXPORT_FIELDS) {
            row[field] = lead[field] ?? "";
          }
          return row;
        });

        const csv = Papa.unparse(exportData, { header: true });
        const timestamp = new Date().toISOString().slice(0, 10);
        downloadCsv(
          csv,
          `solarlead-export-${useFilters ? "filtered" : "all"}-${timestamp}.csv`
        );
        setExportCount(leads.length);
      } catch (err) {
        console.error("Export error:", err);
      } finally {
        setExporting(false);
      }
    },
    [status, category, city, minScore, maxScore]
  );

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Export-Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Alle Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value || "_all"}
                      value={opt.value || "_all"}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Kategorie</Label>
              <Input
                placeholder="z.B. Lagerhalle"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Stadt</Label>
              <Input
                placeholder="z.B. Berlin"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Min. Score</Label>
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="0"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Max. Score</Label>
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="100"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export buttons */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => doExport(false)}
          disabled={exporting}
          variant="outline"
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Alle Leads exportieren
        </Button>
        <Button onClick={() => doExport(true)} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Gefilterte exportieren
        </Button>
      </div>

      {/* Result feedback */}
      {exportCount !== null && (
        <Card
          className={
            exportCount > 0
              ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
              : "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950"
          }
        >
          <CardContent className="flex items-center gap-3 pt-6">
            {exportCount > 0 ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {exportCount} Lead{exportCount !== 1 ? "s" : ""} als CSV
                  exportiert.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Keine Leads mit den ausgewählten Filtern gefunden.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
