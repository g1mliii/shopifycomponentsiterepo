"use client";

import Link from "next/link";

import type { PublicComponentById } from "@/lib/components/component-by-id";

type SandboxHeaderProps = {
  component: PublicComponentById;
  canDownloadPatched: boolean;
  onDownloadPatched: () => void;
  isWorkspaceFullWidth: boolean;
  onToggleWorkspaceWidth: () => void;
  lastRenderDurationMs: number | null;
  renderP95Ms: number | null;
  isRendering: boolean;
  isPendingTransition: boolean;
};

export function SandboxHeader({
  component,
  canDownloadPatched,
  onDownloadPatched,
  isWorkspaceFullWidth,
  onToggleWorkspaceWidth,
  lastRenderDurationMs,
  renderP95Ms,
  isRendering,
  isPendingTransition,
}: SandboxHeaderProps) {
  return (
    <header className="sandbox-card mb-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring text-sm"
        >
          Back to Gallery
        </Link>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/components/${encodeURIComponent(component.id)}/download`}
            title="Download original Liquid file"
            className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring text-sm"
          >
            Download Original
          </a>
          <button
            type="button"
            onClick={onDownloadPatched}
            disabled={!canDownloadPatched}
            title="Download edited Liquid file (current sandbox values)"
            className="sandbox-btn sandbox-btn-primary sandbox-focus-ring text-sm"
          >
            Download Current
          </button>
          <button
            type="button"
            onClick={onToggleWorkspaceWidth}
            title={isWorkspaceFullWidth ? "Use contained workspace width" : "Fill available window width"}
            className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring text-sm"
            aria-pressed={isWorkspaceFullWidth}
          >
            {isWorkspaceFullWidth ? "Contained Width" : "Fill Width"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="page-eyebrow mb-2">Live editor</p>
          <h1 className="font-display sandbox-title text-3xl sm:text-4xl">Liquid Sandbox</h1>
          <p className="sandbox-muted mt-2 text-sm">
            {component.title} · {component.category}
          </p>
          <p className="sandbox-muted mt-3 max-w-xl text-sm leading-relaxed">
            Tune schema-backed settings, preview the result instantly, and download the current defaults when the component feels ready.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span
            className={`sandbox-badge ${isRendering || isPendingTransition ? "sandbox-badge-simulated" : ""}`}
          >
            {isRendering || isPendingTransition ? "Rendering preview" : "Preview ready"}
          </span>
          <details className="sandbox-muted text-xs">
            <summary className="cursor-pointer select-none font-semibold">Performance details</summary>
            <div className="mt-2 space-y-1 text-right">
              <p>Last render: {lastRenderDurationMs !== null ? `${lastRenderDurationMs}ms` : "—"}</p>
              <p>p95 render: {renderP95Ms !== null ? `${renderP95Ms}ms` : "—"}</p>
              <p>Target: ≤120ms p95</p>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
