import { Liquid, type Template } from "liquidjs";

import type { LiquidEditorState } from "./schema-types";

const TEMPLATE_CACHE_MAX_ENTRIES = 50;
const SCHEMA_BLOCK_PATTERN = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i;
const STYLE_BLOCK_PATTERN = /{%\s*style\s*%}([\s\S]*?){%\s*endstyle\s*%}/gi;
const STYLESHEET_BLOCK_PATTERN = /{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/gi;
const JAVASCRIPT_BLOCK_PATTERN = /{%\s*javascript\s*%}([\s\S]*?){%\s*endjavascript\s*%}/gi;
const PREVIEW_ABORT_ERROR_NAME = "AbortError";
const PREVIEW_SECTION_ID = "pressplay-preview-section";

const templateCache = new Map<string, Template[]>();

const liquidEngine = new Liquid({
  strictFilters: false,
  strictVariables: false,
  lenientIf: true,
});

function createAbortError(): Error {
  const error = new Error("Preview render aborted.");
  error.name = PREVIEW_ABORT_ERROR_NAME;
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function withAbortSignal<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
  if (!signal) {
    return task();
  }

  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });

    void task().then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function touchCacheEntry(key: string, template: Template[]): void {
  templateCache.delete(key);
  templateCache.set(key, template);

  while (templateCache.size > TEMPLATE_CACHE_MAX_ENTRIES) {
    const oldestKey = templateCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    templateCache.delete(oldestKey);
  }
}

function stripSchemaBlock(source: string): string {
  const match = SCHEMA_BLOCK_PATTERN.exec(source);
  if (!match) {
    return source;
  }

  const fullStart = match.index;
  const raw = match[0] ?? "";
  const fullEnd = fullStart + raw.length;
  return `${source.slice(0, fullStart)}${source.slice(fullEnd)}`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeShopifyThemeBlocks(source: string): string {
  return source
    .replace(STYLE_BLOCK_PATTERN, (_match, css) => `<style>${css}</style>`)
    .replace(STYLESHEET_BLOCK_PATTERN, (_match, css) => `<style>${css}</style>`)
    .replace(JAVASCRIPT_BLOCK_PATTERN, (_match, javascript) => `<script>${javascript}</script>`);
}

async function getCompiledTemplate(source: string): Promise<Template[]> {
  const withoutSchema = stripSchemaBlock(source);
  const normalizedSource = normalizeShopifyThemeBlocks(withoutSchema);
  const cached = templateCache.get(normalizedSource);
  if (cached) {
    touchCacheEntry(normalizedSource, cached);
    return cached;
  }

  const compiled = await liquidEngine.parse(normalizedSource);
  touchCacheEntry(normalizedSource, compiled);
  return compiled;
}

function toLiquidContext(state: LiquidEditorState): Record<string, unknown> {
  return {
    section: {
      id: PREVIEW_SECTION_ID,
      settings: state.sectionSettings,
      blocks: state.blocks.map((block, index) => ({
        id: block.id || `block-${index + 1}`,
        type: block.type,
        settings: block.settings,
        shopify_attributes: `data-block-id="${escapeHtmlAttribute(block.id || `block-${index + 1}`)}" data-block-type="${escapeHtmlAttribute(block.type)}"`,
      })),
    },
  };
}

function wrapInPreviewSection(html: string): string {
  return `<div id="shopify-section-${PREVIEW_SECTION_ID}" class="shopify-section">${html}</div>`;
}

export interface LiquidRenderResult {
  html: string;
  durationMs: number;
}

export async function renderLiquidPreview(
  source: string,
  state: LiquidEditorState,
  signal?: AbortSignal,
): Promise<LiquidRenderResult> {
  const startedAt = Date.now();
  const compiledTemplate = await withAbortSignal(signal, () => getCompiledTemplate(source));
  throwIfAborted(signal);
  const renderedHtml = await withAbortSignal(signal, () =>
    liquidEngine.render(compiledTemplate, toLiquidContext(state)),
  );
  throwIfAborted(signal);
  const html = wrapInPreviewSection(renderedHtml);

  return {
    html,
    durationMs: Date.now() - startedAt,
  };
}

export function clearLiquidTemplateCacheForTests(): void {
  templateCache.clear();
}
