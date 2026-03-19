import type { LiquidEditorState } from "@/lib/liquid/schema-types";

export const MIN_SPLIT_PERCENT = 18;
export const MAX_SPLIT_PERCENT = 82;
export const KEYBOARD_SPLIT_STEP_PERCENT = 4;
export const PREVIEW_ENQUEUE_DEBOUNCE_MS = 80;
export const LOCAL_MEDIA_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export type PreviewMode = "section" | "overlay";

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function applyNonceToPreviewScripts(html: string, nonce: string | null | undefined): string {
  if (!nonce) {
    return html;
  }

  const escapedNonce = escapeHtmlAttribute(nonce);
  return html.replace(/<script\b([^>]*)>/gi, (match, attributes: string) => {
    if (/\bnonce\s*=/.test(attributes)) {
      return match;
    }

    return `<script nonce="${escapedNonce}"${attributes}>`;
  });
}

function normalizeInlinePreviewHandlers(html: string): string {
  let normalizedHtml = html.replace(
    /\s+onclick="document\.getElementById\('([^']+)'\)\.scrollBy\(\{left:\s*(-?\d+),\s*behavior:\s*'smooth'\}\)"/gi,
    (_match, targetId: string, leftAmount: string) =>
      ` data-pressplay-scroll-target="${escapeHtmlAttribute(targetId)}" data-pressplay-scroll-left="${escapeHtmlAttribute(leftAmount)}"`,
  );

  normalizedHtml = normalizedHtml.replace(
    /\s+onclick="this\.parentElement\.classList\.toggle\('([^']+)'\)"/gi,
    (_match, className: string) =>
      ` data-pressplay-toggle-parent-class="${escapeHtmlAttribute(className)}"`,
  );

  return normalizedHtml;
}

export function toTitleSlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 64) : "component";
}

export function buildPreviewDocument(html: string, nonce?: string | null): string {
  const escapedNonce = nonce ? escapeHtmlAttribute(nonce) : null;
  const scriptPolicy = escapedNonce
    ? `script-src 'unsafe-inline' 'nonce-${escapedNonce}'`
    : "script-src 'unsafe-inline'";
  const previewHtml = applyNonceToPreviewScripts(normalizeInlinePreviewHandlers(html), escapedNonce);
  const previewScriptNonceAttribute = escapedNonce ? ` nonce="${escapedNonce}"` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; ${scriptPolicy}; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; media-src data: blob: https: http:; font-src data: https: http:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';"
    />
    <style>
      :root { color-scheme: light; }
      html, body {
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
      }
      body {
        margin: 0;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #111827;
        background: #ffffff;
      }
      #pressplay-preview-root {
        transform-origin: top center;
      }
      #pressplay-preview-root :where(img, video, iframe, svg, canvas) {
        max-width: 100%;
        height: auto;
      }
      img, video { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <div id="pressplay-preview-root">${previewHtml}</div>
    <script${previewScriptNonceAttribute}>
      (function () {
        var root = document.getElementById("pressplay-preview-root");
        if (!root) {
          return;
        }

        var rafId = 0;
        var deferredFitTimerId = 0;
        var resizeObserver = null;
        var mutationObserver = null;
        var lastViewportWidth = 0;
        var lastContentWidth = 0;
        var lastContentHeight = 0;
        var lastScale = 0;

        function applyFitScale() {
          rafId = 0;
          root.style.transform = "";
          root.style.width = "auto";
          root.style.margin = "";

          var viewportWidth = Math.max(320, window.innerWidth - 24);
          var contentWidth = Math.max(1, root.scrollWidth);
          var contentHeight = Math.max(1, root.scrollHeight);
          var widthScale = viewportWidth / contentWidth;
          var scale = Math.min(1, widthScale);

          if (
            viewportWidth === lastViewportWidth
            && contentWidth === lastContentWidth
            && contentHeight === lastContentHeight
            && scale === lastScale
          ) {
            return;
          }

          lastViewportWidth = viewportWidth;
          lastContentWidth = contentWidth;
          lastContentHeight = contentHeight;
          lastScale = scale;

          if (scale >= 0.999) {
            document.body.style.minHeight = contentHeight + 24 + "px";
            reportPreviewMetrics();
            return;
          }

          root.style.width = contentWidth + "px";
          root.style.transform = "scale(" + scale + ")";
          root.style.margin = "0 auto";
          var scaledHeight = Math.ceil(contentHeight * scale);
          document.body.style.minHeight = scaledHeight + 24 + "px";
          reportPreviewMetrics();
        }

        function reportPreviewMetrics() {
          if (!window.parent || window.parent === window) {
            return;
          }

          var elements = root.querySelectorAll("*");
          var minTop = Number.POSITIVE_INFINITY;
          var maxBottom = Number.NEGATIVE_INFINITY;
          var maxRight = Number.NEGATIVE_INFINITY;

          for (var index = 0; index < elements.length; index += 1) {
            var element = elements[index];
            if (!(element instanceof HTMLElement)) {
              continue;
            }

            var rect = element.getBoundingClientRect();
            if (rect.width <= 0 && rect.height <= 0) {
              continue;
            }

            minTop = Math.min(minTop, rect.top);
            maxBottom = Math.max(maxBottom, rect.bottom);
            maxRight = Math.max(maxRight, rect.right);
          }

          var rootRect = root.getBoundingClientRect();
          var visualTop = Number.isFinite(minTop) ? Math.min(minTop, rootRect.top) : rootRect.top;
          var visualBottom = Number.isFinite(maxBottom) ? Math.max(maxBottom, rootRect.bottom) : rootRect.bottom;
          var visualRight = Number.isFinite(maxRight) ? Math.max(maxRight, rootRect.right) : rootRect.right;

          window.parent.postMessage({
            type: "pressplay-preview-metrics",
            visualHeight: Math.max(1, Math.ceil(visualBottom - visualTop)),
            visualWidth: Math.max(1, Math.ceil(visualRight - rootRect.left)),
            flowHeight: Math.max(1, Math.ceil(root.scrollHeight)),
            scale: lastScale || 1,
          }, "*");
        }

        function queueFitScale() {
          if (rafId !== 0) {
            return;
          }

          rafId = window.requestAnimationFrame(applyFitScale);
        }

        function queueDeferredFitScale() {
          if (deferredFitTimerId !== 0) {
            window.clearTimeout(deferredFitTimerId);
          }

          deferredFitTimerId = window.setTimeout(function () {
            deferredFitTimerId = 0;
            queueFitScale();
          }, 48);
        }

        window.addEventListener("resize", queueFitScale, { passive: true });

        if (typeof ResizeObserver === "function") {
          resizeObserver = new ResizeObserver(queueFitScale);
          resizeObserver.observe(document.documentElement);
          resizeObserver.observe(root);
        }

        if (typeof MutationObserver === "function") {
          mutationObserver = new MutationObserver(queueDeferredFitScale);
          mutationObserver.observe(root, {
            childList: true,
            subtree: true,
          });
        }

        if (document.readyState === "complete") {
          queueFitScale();
        } else {
          window.addEventListener("load", queueFitScale, { once: true });
        }

        document.addEventListener("click", function (event) {
          var target = event.target;
          if (!(target instanceof Element)) {
            return;
          }

          var scrollTrigger = target.closest("[data-pressplay-scroll-target]");
          if (scrollTrigger instanceof HTMLElement) {
            var scrollTargetId = scrollTrigger.getAttribute("data-pressplay-scroll-target");
            var scrollLeftRaw = scrollTrigger.getAttribute("data-pressplay-scroll-left");
            if (!scrollTargetId || !scrollLeftRaw) {
              return;
            }

            var scrollElement = document.getElementById(scrollTargetId);
            var scrollLeft = Number.parseFloat(scrollLeftRaw);
            if (!scrollElement || !Number.isFinite(scrollLeft)) {
              return;
            }

            event.preventDefault();
            scrollElement.scrollBy({ left: scrollLeft, behavior: "smooth" });
            return;
          }

          var toggleTrigger = target.closest("[data-pressplay-toggle-parent-class]");
          if (toggleTrigger instanceof HTMLElement) {
            var className = toggleTrigger.getAttribute("data-pressplay-toggle-parent-class");
            if (!className || !toggleTrigger.parentElement) {
              return;
            }

            event.preventDefault();
            toggleTrigger.parentElement.classList.toggle(className);
          }
        });

        window.requestAnimationFrame(queueFitScale);

        window.addEventListener("pagehide", function () {
          if (rafId !== 0) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
          }

          if (deferredFitTimerId !== 0) {
            window.clearTimeout(deferredFitTimerId);
            deferredFitTimerId = 0;
          }

          if (resizeObserver) {
            resizeObserver.disconnect();
          }

          if (mutationObserver) {
            mutationObserver.disconnect();
          }
        }, { once: true });
      })();
    </script>
  </body>
</html>`;
}

export function createAbortError(): Error {
  const error = new Error("Preview render aborted.");
  error.name = "AbortError";
  return error;
}

export function readLocalMediaFileAsDataUrl(file: File): Promise<string> {
  if (file.size > LOCAL_MEDIA_PREVIEW_MAX_BYTES) {
    const maxSizeMb = Math.floor(LOCAL_MEDIA_PREVIEW_MAX_BYTES / 1024 / 1024);
    return Promise.reject(
      new Error(`Local preview file is too large. Use a file under ${maxSizeMb}MB.`),
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.length > 0) {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read local media file."));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read local media file."));
    };

    reader.readAsDataURL(file);
  });
}

export function clampSplitPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_SPLIT_PERCENT;
  }

  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
}

export function getSectionSettingPath(settingId: string): string {
  return `section:${settingId}`;
}

export function getBlockSettingPath(blockId: string, settingId: string): string {
  return `block:${blockId}:${settingId}`;
}

export type ParsedSettingPath =
  | { kind: "section"; settingId: string }
  | { kind: "block"; blockId: string; settingId: string };

export function parseSettingPath(pathKey: string): ParsedSettingPath | null {
  if (pathKey.startsWith("section:")) {
    return {
      kind: "section",
      settingId: pathKey.slice("section:".length),
    };
  }

  if (pathKey.startsWith("block:")) {
    const segments = pathKey.split(":");
    if (segments.length >= 3) {
      return {
        kind: "block",
        blockId: segments[1] ?? "",
        settingId: segments.slice(2).join(":"),
      };
    }
  }

  return null;
}

export function applyMediaOverrides(
  editorState: LiquidEditorState,
  mediaOverrides: Record<string, string>,
): LiquidEditorState {
  const mediaOverrideEntries = Object.entries(mediaOverrides);
  if (mediaOverrideEntries.length === 0) {
    return editorState;
  }

  let sectionSettings = editorState.sectionSettings;
  let blocks = editorState.blocks;
  let blockIndexById: Map<string, number> | null = null;

  for (const [pathKey, overrideUrl] of mediaOverrideEntries) {
    const parsed = parseSettingPath(pathKey);
    if (!parsed) {
      continue;
    }

    if (parsed.kind === "section") {
      if (sectionSettings[parsed.settingId] === overrideUrl) {
        continue;
      }

      if (sectionSettings === editorState.sectionSettings) {
        sectionSettings = { ...editorState.sectionSettings };
      }
      sectionSettings[parsed.settingId] = overrideUrl;
      continue;
    }

    if (!blockIndexById) {
      blockIndexById = new Map<string, number>();
      for (const [index, block] of editorState.blocks.entries()) {
        blockIndexById.set(block.id, index);
      }
    }

    const blockIndex = blockIndexById.get(parsed.blockId);
    if (blockIndex === undefined) {
      continue;
    }

    const block = blocks[blockIndex];
    if (block.settings[parsed.settingId] === overrideUrl) {
      continue;
    }

    if (blocks === editorState.blocks) {
      blocks = [...editorState.blocks];
    }

    const currentBlock = blocks[blockIndex];
    blocks[blockIndex] = {
      ...currentBlock,
      settings: {
        ...currentBlock.settings,
        [parsed.settingId]: overrideUrl,
      },
    };
  }

  if (sectionSettings === editorState.sectionSettings && blocks === editorState.blocks) {
    return editorState;
  }

  return {
    sectionSettings,
    blocks,
  };
}
