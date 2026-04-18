"use client";

import { Kanban } from "lucide-react";
import { KanbanBoard } from "@/components/pipeline/kanban-board";

export default function PipelinePage() {
  return (
    <div className="flex flex-col gap-4 -m-8 p-0 h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-6 pb-2 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Kanban className="h-6 w-6 text-green-600" />
            Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Leads nach Vertriebsstatus organisieren
          </p>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto px-8 pb-6">
        <KanbanBoard />
      </div>
    </div>
  );
}
