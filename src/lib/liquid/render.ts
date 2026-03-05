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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNamedFilterArgs(args: unknown[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  for (const arg of args) {
    if (!Array.isArray(arg) || arg.length !== 2) {
      continue;
    }

    const [name, value] = arg;
    if (typeof name !== "string") {
      continue;
    }

    options[name] = value;
  }

  return options;
}

function toMediaSourceUrl(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (isRecord(value)) {
    for (const key of ["src", "url", "featured_image", "image", "poster"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  return "";
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
      return false;
    }

    return true;
  }

  return Boolean(value);
}

function buildHtmlAttributeString(attributes: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [name, rawValue] of Object.entries(attributes)) {
    if (rawValue === null || rawValue === undefined || rawValue === false) {
      continue;
    }

    const escapedName = escapeHtmlAttribute(name);

    if (rawValue === true) {
      parts.push(`${escapedName}`);
      continue;
    }

    parts.push(`${escapedName}="${escapeHtmlAttribute(String(rawValue))}"`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

liquidEngine.registerFilter("image_url", (input: unknown) => {
  return toMediaSourceUrl(input);
});

liquidEngine.registerFilter("image_tag", (input: unknown, ...args: unknown[]) => {
  const source = toMediaSourceUrl(input);
  if (!source) {
    return "";
  }

  const options = parseNamedFilterArgs(args);
  const attributes: Record<string, unknown> = {
    src: source,
    alt: typeof options.alt === "string" ? options.alt : "",
    loading: typeof options.loading === "string" ? options.loading : undefined,
    class: typeof options.class === "string" ? options.class : undefined,
    width: typeof options.width === "number" || typeof options.width === "string" ? options.width : undefined,
    height: typeof options.height === "number" || typeof options.height === "string" ? options.height : undefined,
    sizes: typeof options.sizes === "string" ? options.sizes : undefined,
    decoding: typeof options.decoding === "string" ? options.decoding : "async",
  };

  return `<img${buildHtmlAttributeString(attributes)} />`;
});

liquidEngine.registerFilter("video_tag", (input: unknown, ...args: unknown[]) => {
  const source = toMediaSourceUrl(input);
  if (!source) {
    return "";
  }

  const options = parseNamedFilterArgs(args);
  const attributes: Record<string, unknown> = {
    class: typeof options.class === "string" ? options.class : undefined,
    poster: toMediaSourceUrl(options.poster),
    controls: options.controls === undefined ? true : toBooleanFlag(options.controls),
    autoplay: toBooleanFlag(options.autoplay),
    loop: toBooleanFlag(options.loop),
    muted: toBooleanFlag(options.muted),
    playsinline: options.playsinline === undefined ? true : toBooleanFlag(options.playsinline),
  };

  const mimeType = source.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4";
  return `<video${buildHtmlAttributeString(attributes)}><source src="${escapeHtmlAttribute(source)}" type="${mimeType}" /></video>`;
});

liquidEngine.registerFilter("money", (input: unknown) => {
  const numericValue = typeof input === "number" ? input : Number.parseFloat(String(input));
  if (!Number.isFinite(numericValue)) {
    return input === null || input === undefined ? "" : String(input);
  }

  const normalized = Number.isInteger(numericValue) ? numericValue / 100 : numericValue;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(normalized);
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
