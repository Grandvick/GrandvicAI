"use client";

import { useActionState, useState, useTransition } from "react";
import { updateDocumentStatusAction, getDocumentUrlAction, uploadDocumentFileAction } from "./actions";
import type { UploadState } from "./actions";
import type { DocumentItem } from "@/lib/business/documents";

const STATUS_OPTIONS: DocumentItem["status"][] = [
  "requested",
  "uploaded",
  "received",
  "pending_review",
  "approved",
  "rejected",
  "expired",
];

export function DocumentRow({ doc }: { doc: DocumentItem }) {
  const [status, setStatus] = useState(doc.status);
  const [statusPending, startStatusTransition] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);

  const [viewPending, startViewTransition] = useTransition();
  const [viewError, setViewError] = useState<string | null>(null);

  const boundUpload = uploadDocumentFileAction.bind(null, doc.id);
  const [uploadState, uploadAction, uploadPending] = useActionState<UploadState, FormData>(
    boundUpload,
    undefined
  );

  function onStatusChange(next: string) {
    const previous = status;
    setStatus(next);
    setStatusError(null);
    startStatusTransition(async () => {
      const result = await updateDocumentStatusAction(doc.id, next);
      if (result?.error) {
        setStatusError(result.error);
        setStatus(previous);
      }
    });
  }

  function onView() {
    if (!doc.storagePath) return;
    setViewError(null);
    startViewTransition(async () => {
      const result = await getDocumentUrlAction(doc.storagePath as string);
      if (result.error) {
        setViewError(result.error);
      } else if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    });
  }

  return (
    <tr className="border-b border-slate-50 align-top last:border-0 hover:bg-slate-50">
      <td className="px-4 py-3 font-medium text-slate-900">{doc.customerName}</td>
      <td className="px-4 py-3 text-slate-600">{doc.documentType}</td>
      <td className="px-4 py-3 text-slate-600">{new Date(doc.requestedAt).toLocaleDateString()}</td>
      <td className="px-4 py-3">
        <select
          value={status}
          disabled={statusPending}
          onChange={(e) => onStatusChange(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o.replace("_", " ")}
            </option>
          ))}
        </select>
        {statusError && <p className="mt-1 text-xs text-red-600">{statusError}</p>}
      </td>
      <td className="px-4 py-3">
        {doc.storagePath ? (
          <div>
            <button
              type="button"
              onClick={onView}
              disabled={viewPending}
              className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-60"
            >
              {viewPending ? "Opening…" : "View file"}
            </button>
            {viewError && <p className="mt-1 text-xs text-red-600">{viewError}</p>}
          </div>
        ) : (
          <form action={uploadAction} className="flex items-center gap-2">
            <input
              type="file"
              name="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              required
              className="w-36 text-xs"
            />
            <button
              type="submit"
              disabled={uploadPending}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              {uploadPending ? "Uploading…" : "Upload"}
            </button>
            {uploadState?.error && <p className="text-xs text-red-600">{uploadState.error}</p>}
          </form>
        )}
      </td>
    </tr>
  );
}
