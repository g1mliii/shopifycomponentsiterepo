import { Liquid, type Template } from "liquidjs";

import type { LiquidEditorState } from "./schema-types";

const TEMPLATE_CACHE_MAX_ENTRIES = 50;
const SCHEMA_BLOCK_PATTERN = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i;
const PREVIEW_ABORT_ERROR_NAME = "AbortError";

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

async function getCompiledTemplate(source: string): Promise<Template[]> {
  const withoutSchema = stripSchemaBlock(source);
  const cached = templateCache.get(withoutSchema);
  if (cached) {
    touchCacheEntry(withoutSchema, cached);
    return cached;
  }

  const compiled = await liquidEngine.parse(withoutSchema);
  touchCacheEntry(withoutSchema, compiled);
  return compiled;
}

function toLiquidContext(state: LiquidEditorState): Record<string, unknown> {
  return {
    section: {
      settings: state.sectionSettings,
      blocks: state.blocks.map((block, index) => ({
        id: block.id || `block-${index + 1}`,
        type: block.type,
        settings: block.settings,
      })),
    },
  };
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
  const html = await withAbortSignal(signal, () =>
    liquidEngine.render(compiledTemplate, toLiquidContext(state)),
  );
  throwIfAborted(signal);

  return {
    html,
    durationMs: Date.now() - startedAt,
  };
}

export function clearLiquidTemplateCacheForTests(): void {
  templateCache.clear();
}
