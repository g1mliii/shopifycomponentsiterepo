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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="sandbox-title text-2xl font-semibold">Liquid Sandbox</h1>
          <p className="sandbox-muted mt-1 text-sm">
            {component.title} · {component.category}
          </p>
        </div>
      </div>
      <div className="sandbox-muted mt-3 flex flex-wrap gap-3 text-xs">
        <span>Last render: {lastRenderDurationMs !== null ? `${lastRenderDurationMs}ms` : "—"}</span>
        <span>p95 render: {renderP95Ms !== null ? `${renderP95Ms}ms` : "—"}</span>
        <span>Target: ≤120ms p95</span>
        {isRendering || isPendingTransition ? <span className="font-medium" style={{ color: "var(--foreground)" }}>Rendering…</span> : null}
      </div>
    </header>
  );
}
