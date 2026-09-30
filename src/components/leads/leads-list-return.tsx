"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

const RETURN_KEY = "solarlead:leads-list-return-url";

/**
 * Merkt sich die aktuelle URL (mit Filter/Sortierung/Tab) in sessionStorage,
 * damit "Zurück zu Leads" von der Detail-Seite dorthin zurückkommt.
 * Wird oben auf /dashboard/leads gemountet.
 */
export function RememberLeadsListUrl() {
  useEffect(() => {
    try {
      const url = window.location.pathname + window.location.search;
      window.sessionStorage.setItem(RETURN_KEY, url);
    } catch {
      // sessionStorage kann in privaten Fenstern blockiert sein — kein Blocker
    }
  }, []);
  return null;
}

/**
 * "Zurück zu Leads"-Link auf der Detail-Seite. Liest die gemerkte
 * Listen-URL aus sessionStorage; Fallback ist /dashboard/leads ohne Filter.
 */
export function LeadsBackLink({
  className,
  label = "Zurück zu Leads",
}: {
  className?: string;
  label?: string;
}) {
  const [href, setHref] = useState("/dashboard/leads");

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(RETURN_KEY);
      if (stored && stored.startsWith("/dashboard/leads")) {
        setHref(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <Link href={href} className={className}>
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
