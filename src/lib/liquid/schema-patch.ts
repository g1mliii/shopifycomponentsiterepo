import type {
  LiquidBlockInstance,
  LiquidEditorState,
  LiquidSchema,
  LiquidSettingJsonValue,
} from "./schema-types";

const SCHEMA_BLOCK_PATTERN = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toJsonValue(value: unknown): LiquidSettingJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (isRecord(value)) {
    const result: { [key: string]: LiquidSettingJsonValue } = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = toJsonValue(nestedValue);
    }
    return result;
  }

  return String(value);
}

function createBlockInstanceId(type: string, index: number): string {
  return `block_${type}_${index + 1}`;
}

function extractFirstSchemaBlock(source: string): {
  jsonStart: number;
  jsonEnd: number;
} | null {
  const match = SCHEMA_BLOCK_PATTERN.exec(source);
  if (!match) {
    return null;
  }

  const fullStart = match.index;
  const raw = match[0] ?? "";
  const json = match[1] ?? "";
  const jsonRelativeStart = raw.indexOf(json);
  const jsonStart = fullStart + (jsonRelativeStart >= 0 ? jsonRelativeStart : 0);
  const jsonEnd = jsonStart + json.length;

  return {
    jsonStart,
    jsonEnd,
  };
}

function getDefaultBlockSettings(schema: LiquidSchema, blockType: string): Record<string, LiquidSettingJsonValue> {
  const definition = schema.blocks.find((block) => block.type === blockType);
  const defaults: Record<string, LiquidSettingJsonValue> = {};

  for (const setting of definition?.settings ?? []) {
    defaults[setting.id] = cloneJsonValue(setting.defaultValue);
  }

  return defaults;
}

export function createBlockInstanceFromDefinition(
  schema: LiquidSchema,
  blockType: string,
  index: number,
): LiquidBlockInstance {
  return {
    id: createBlockInstanceId(blockType, index),
    type: blockType,
    settings: getDefaultBlockSettings(schema, blockType),
  };
}

export function buildInitialEditorState(schema: LiquidSchema): LiquidEditorState {
  const sectionSettings: Record<string, LiquidSettingJsonValue> = {};
  for (const setting of schema.settings) {
    sectionSettings[setting.id] = cloneJsonValue(setting.defaultValue);
  }

  const blocks: LiquidBlockInstance[] = [];
  const firstPresetBlocks = schema.presets[0]?.blocks ?? [];

  if (firstPresetBlocks.length > 0) {
    for (const [index, presetBlock] of firstPresetBlocks.entries()) {
      const defaults = getDefaultBlockSettings(schema, presetBlock.type);
      blocks.push({
        id: createBlockInstanceId(presetBlock.type, index),
        type: presetBlock.type,
        settings: {
          ...defaults,
          ...cloneJsonValue(presetBlock.settings),
        },
      });
    }
  } else {
    for (const definition of schema.blocks) {
      if (definition.limit !== null && definition.limit <= 0) {
        continue;
      }

      blocks.push(createBlockInstanceFromDefinition(schema, definition.type, blocks.length));
    }
  }

  return {
    sectionSettings,
    blocks,
  };
}

export function patchLiquidSchemaDefaults(
  source: string,
  schema: LiquidSchema,
  state: LiquidEditorState,
): string {
  const blockMatch = extractFirstSchemaBlock(source);
  if (!blockMatch) {
    return source;
  }

  const root = cloneJsonValue(schema.raw) as Record<string, unknown>;

  if (Array.isArray(root.settings)) {
    for (const settingEntry of root.settings) {
      if (!isRecord(settingEntry)) {
        continue;
      }

      const settingId = typeof settingEntry.id === "string" ? settingEntry.id : null;
      if (!settingId) {
        continue;
      }

      if (settingId in state.sectionSettings) {
        settingEntry.default = toJsonValue(state.sectionSettings[settingId]);
      }
    }
  }

  const firstBlockByType = new Map<string, LiquidBlockInstance>();
  for (const block of state.blocks) {
    if (!firstBlockByType.has(block.type)) {
      firstBlockByType.set(block.type, block);
    }
  }

  if (Array.isArray(root.blocks)) {
    for (const blockEntry of root.blocks) {
      if (!isRecord(blockEntry)) {
        continue;
      }

      const blockType = typeof blockEntry.type === "string" ? blockEntry.type : null;
      if (!blockType || !Array.isArray(blockEntry.settings)) {
        continue;
      }

      const firstInstance = firstBlockByType.get(blockType);
      if (!firstInstance) {
        continue;
      }

      for (const settingEntry of blockEntry.settings) {
        if (!isRecord(settingEntry)) {
          continue;
        }

        const settingId = typeof settingEntry.id === "string" ? settingEntry.id : null;
        if (!settingId) {
          continue;
        }

        if (settingId in firstInstance.settings) {
          settingEntry.default = toJsonValue(firstInstance.settings[settingId]);
        }
      }
    }
  }

  const presets = Array.isArray(root.presets) ? root.presets : [];
  if (!Array.isArray(root.presets)) {
    root.presets = presets;
  }

  if (!isRecord(presets[0])) {
    presets[0] = {
      name: schema.presets[0]?.name ?? schema.name,
      blocks: [],
    };
  }

  const firstPreset = presets[0] as Record<string, unknown>;
  firstPreset.blocks = state.blocks.map((block) => ({
    type: block.type,
    settings: cloneJsonValue(block.settings),
  }));

  const patchedSchemaJson = JSON.stringify(root, null, 2);
  const normalizedJson = `\n${patchedSchemaJson}\n`;

  return `${source.slice(0, blockMatch.jsonStart)}${normalizedJson}${source.slice(blockMatch.jsonEnd)}`;
}
