"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, temperatureTone } from "@/components/ui/badge";
import { moveLeadStageAction } from "./actions";
import type { LeadListItem } from "@/lib/business/leads";
import type { PipelineStage } from "@/lib/business/pipeline-stages";

export function PipelineBoard({
  stages,
  leads,
}: {
  stages: PipelineStage[];
  leads: LeadListItem[];
}) {
  const [items, setItems] = useState(leads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDrop(stageKey: string) {
    if (!dragId) return;
    const id = dragId;
    const lead = items.find((l) => l.id === id);
    setDragId(null);
    if (!lead || lead.stage === stageKey) return;

    const previousStage = lead.stage;
    setError(null);
    setItems((prev) => prev.map((l) => (l.id === id ? { ...l, stage: stageKey } : l)));

    startTransition(async () => {
      const result = await moveLeadStageAction(id, stageKey);
      if (result?.error) {
        setError(result.error);
        setItems((prev) => prev.map((l) => (l.id === id ? { ...l, stage: previousStage } : l)));
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const stageLeads = items.filter((l) => l.stage === stage.key);
          return (
            <div
              key={stage.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(stage.key)}
              className="w-72 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-sm font-semibold text-slate-700">{stage.label}</h3>
                <span className="text-xs text-slate-400">{stageLeads.length}</span>
              </div>
              <div className="space-y-2">
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    className="cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-sm font-medium text-slate-900 hover:underline"
                    >
                      {lead.customerName}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      {lead.service || "—"} {lead.targetCountry ? `→ ${lead.targetCountry}` : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge tone={temperatureTone(lead.temperature)}>{lead.temperature}</Badge>
                      <span className="text-xs text-slate-400">Score {lead.score}</span>
                    </div>
                  </div>
                ))}
                {stageLeads.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                    Drop leads here
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
