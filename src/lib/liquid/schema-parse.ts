import type {
  LiquidSchema,
  LiquidSchemaBlockDefinition,
  LiquidSchemaBlockMatch,
  LiquidSchemaDiagnostic,
  LiquidSchemaOption,
  LiquidSchemaPreset,
  LiquidSchemaPresetBlock,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
  LiquidSettingSupport,
  ParsedLiquidSchemaResult,
} from "./schema-types";

const SCHEMA_BLOCK_PATTERN = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i;

const NATIVE_SETTING_TYPES = new Set([
  "checkbox",
  "color",
  "color_background",
  "color_scheme",
  "font_picker",
  "html",
  "inline_richtext",
  "liquid",
  "number",
  "radio",
  "range",
  "richtext",
  "select",
  "text",
  "text_alignment",
  "textarea",
  "url",
  "video",
  "video_url",
  "image_picker",
]);

const SIMULATED_SETTING_TYPES = new Set([
  "article",
  "blog",
  "collection",
  "collection_list",
  "link_list",
  "metaobject",
  "metaobject_list",
  "page",
  "product",
  "product_list",
]);

const NON_CONTROL_SETTING_TYPES = new Set(["header", "paragraph"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
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
    return value.map((item) => toJsonValue(item));
  }

  if (isRecord(value)) {
    const nextObject: { [key: string]: LiquidSettingJsonValue } = {};
    for (const [key, entryValue] of Object.entries(value)) {
      nextObject[key] = toJsonValue(entryValue);
    }
    return nextObject;
  }

  return String(value);
}

function getSettingSupport(type: string): LiquidSettingSupport {
  const normalized = type.toLowerCase();
  if (NATIVE_SETTING_TYPES.has(normalized)) {
    return "native";
  }

  if (SIMULATED_SETTING_TYPES.has(normalized)) {
    return "simulated";
  }

  return "unknown";
}

function getDefaultValueForType(
  type: string,
  options: LiquidSchemaOption[],
): LiquidSettingJsonValue {
  switch (type) {
    case "checkbox":
      return false;
    case "number":
    case "range":
      return 0;
    case "select":
    case "radio":
      return options[0]?.value ?? "";
    case "collection_list":
    case "metaobject_list":
    case "product_list":
      return [];
    default:
      return "";
  }
}

function parseOptions(
  value: unknown,
  diagnostics: LiquidSchemaDiagnostic[],
  path: string,
): LiquidSchemaOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: LiquidSchemaOption[] = [];

  for (const [index, optionValue] of value.entries()) {
    if (!isRecord(optionValue)) {
      diagnostics.push({
        code: "invalid_setting_option",
        level: "warning",
        message: "Setting option is not an object and was ignored.",
        path: `${path}.options[${index}]`,
      });
      continue;
    }

    const optionRawValue = asString(optionValue.value);
    if (!optionRawValue) {
      diagnostics.push({
        code: "invalid_setting_option_value",
        level: "warning",
        message: "Setting option is missing a value and was ignored.",
        path: `${path}.options[${index}]`,
      });
      continue;
    }

    options.push({
      value: optionRawValue,
      label: asString(optionValue.label) ?? optionRawValue,
    });
  }

  return options;
}

function parseSetting(
  value: unknown,
  index: number,
  diagnostics: LiquidSchemaDiagnostic[],
  path: string,
): LiquidSchemaSetting | null {
  if (!isRecord(value)) {
    diagnostics.push({
      code: "invalid_setting_shape",
      level: "warning",
      message: "Setting entry is not an object and was ignored.",
      path: `${path}[${index}]`,
    });
    return null;
  }

  const settingPath = `${path}[${index}]`;
  const id = asString(value.id) ?? `setting_${index + 1}`;
  const type = (asString(value.type) ?? "text").toLowerCase();

  if (NON_CONTROL_SETTING_TYPES.has(type)) {
    return null;
  }

  const options = parseOptions(value.options, diagnostics, settingPath);
  const defaultValue =
    value.default !== undefined ? toJsonValue(value.default) : getDefaultValueForType(type, options);

  if (!asString(value.id)) {
    diagnostics.push({
      code: "missing_setting_id",
      level: "warning",
      message: `Setting at index ${index + 1} is missing an id; generated id "${id}" was used.`,
      path: settingPath,
    });
  }

  if (!asString(value.type)) {
    diagnostics.push({
      code: "missing_setting_type",
      level: "warning",
      message: `Setting "${id}" is missing a type; "text" was used.`,
      path: settingPath,
    });
  }

  return {
    id,
    type,
    label: asString(value.label) ?? id,
    defaultValue,
    support: getSettingSupport(type),
    options,
    min: asNumber(value.min),
    max: asNumber(value.max),
    step: asNumber(value.step),
    placeholder: asString(value.placeholder),
    info: asString(value.info),
    raw: value,
  };
}

function parseBlockDefinition(
  value: unknown,
  index: number,
  diagnostics: LiquidSchemaDiagnostic[],
): LiquidSchemaBlockDefinition | null {
  if (!isRecord(value)) {
    diagnostics.push({
      code: "invalid_block_shape",
      level: "warning",
      message: "Block definition entry is not an object and was ignored.",
      path: `blocks[${index}]`,
    });
    return null;
  }

  const type = asString(value.type) ?? `block_${index + 1}`;
  const settingsRaw = Array.isArray(value.settings) ? value.settings : [];
  const settings: LiquidSchemaSetting[] = [];

  for (const [settingIndex, settingValue] of settingsRaw.entries()) {
    const parsedSetting = parseSetting(
      settingValue,
      settingIndex,
      diagnostics,
      `blocks[${index}].settings`,
    );
    if (parsedSetting) {
      settings.push(parsedSetting);
    }
  }

  return {
    type,
    name: asString(value.name) ?? type,
    limit: asNumber(value.limit),
    settings,
    raw: value,
  };
}

function parsePresetBlock(
  value: unknown,
  index: number,
  diagnostics: LiquidSchemaDiagnostic[],
  path: string,
): LiquidSchemaPresetBlock | null {
  if (!isRecord(value)) {
    diagnostics.push({
      code: "invalid_preset_block_shape",
      level: "warning",
      message: "Preset block entry is not an object and was ignored.",
      path: `${path}[${index}]`,
    });
    return null;
  }

  const type = asString(value.type);
  if (!type) {
    diagnostics.push({
      code: "missing_preset_block_type",
      level: "warning",
      message: "Preset block is missing a type and was ignored.",
      path: `${path}[${index}]`,
    });
    return null;
  }

  const settings: Record<string, LiquidSettingJsonValue> = {};
  if (isRecord(value.settings)) {
    for (const [settingId, settingValue] of Object.entries(value.settings)) {
      settings[settingId] = toJsonValue(settingValue);
    }
  }

  return {
    type,
    settings,
    raw: value,
  };
}

function parsePreset(
  value: unknown,
  index: number,
  diagnostics: LiquidSchemaDiagnostic[],
): LiquidSchemaPreset | null {
  if (!isRecord(value)) {
    diagnostics.push({
      code: "invalid_preset_shape",
      level: "warning",
      message: "Preset entry is not an object and was ignored.",
      path: `presets[${index}]`,
    });
    return null;
  }

  const blocksRaw = Array.isArray(value.blocks) ? value.blocks : [];
  const blocks: LiquidSchemaPresetBlock[] = [];
  for (const [blockIndex, blockValue] of blocksRaw.entries()) {
    const parsed = parsePresetBlock(
      blockValue,
      blockIndex,
      diagnostics,
      `presets[${index}].blocks`,
    );
    if (parsed) {
      blocks.push(parsed);
    }
  }

  return {
    name: asString(value.name) ?? `Preset ${index + 1}`,
    blocks,
    raw: value,
  };
}

export function extractFirstSchemaBlock(source: string): LiquidSchemaBlockMatch | null {
  const match = SCHEMA_BLOCK_PATTERN.exec(source);
  if (!match) {
    return null;
  }

  const fullStart = match.index;
  const raw = match[0] ?? "";
  const json = match[1] ?? "";
  const fullEnd = fullStart + raw.length;
  const jsonRelativeStart = raw.indexOf(json);
  const jsonStart = fullStart + (jsonRelativeStart >= 0 ? jsonRelativeStart : 0);
  const jsonEnd = jsonStart + json.length;

  return {
    raw,
    json,
    fullStart,
    fullEnd,
    jsonStart,
    jsonEnd,
  };
}

export function parseLiquidSchema(source: string): ParsedLiquidSchemaResult {
  const diagnostics: LiquidSchemaDiagnostic[] = [];
  const blockMatch = extractFirstSchemaBlock(source);

  if (!blockMatch) {
    diagnostics.push({
      code: "schema_block_missing",
      level: "error",
      message: "Liquid file does not contain a {% schema %}...{% endschema %} block.",
    });

    return {
      schema: null,
      diagnostics,
      blockMatch: null,
    };
  }

  const rawJson = blockMatch.json.trim();
  if (!rawJson) {
    diagnostics.push({
      code: "schema_json_missing",
      level: "error",
      message: "Schema block is empty.",
    });

    return {
      schema: null,
      diagnostics,
      blockMatch,
    };
  }

  let parsedSchemaJson: unknown;
  try {
    parsedSchemaJson = JSON.parse(rawJson);
  } catch (error) {
    diagnostics.push({
      code: "schema_json_invalid",
      level: "error",
      message:
        error instanceof Error ? `Schema JSON is invalid: ${error.message}` : "Schema JSON is invalid.",
    });

    return {
      schema: null,
      diagnostics,
      blockMatch,
    };
  }

  if (!isRecord(parsedSchemaJson)) {
    diagnostics.push({
      code: "schema_root_invalid",
      level: "error",
      message: "Schema JSON root must be an object.",
    });

    return {
      schema: null,
      diagnostics,
      blockMatch,
    };
  }

  const schemaObject = parsedSchemaJson;
  const settingsRaw = Array.isArray(schemaObject.settings) ? schemaObject.settings : [];
  const blocksRaw = Array.isArray(schemaObject.blocks) ? schemaObject.blocks : [];
  const presetsRaw = Array.isArray(schemaObject.presets) ? schemaObject.presets : [];

  if (!Array.isArray(schemaObject.settings)) {
    diagnostics.push({
      code: "settings_missing",
      level: "warning",
      message: "Schema settings are missing or invalid; controls will start empty.",
      path: "settings",
    });
  }

  const settings: LiquidSchemaSetting[] = [];
  for (const [index, value] of settingsRaw.entries()) {
    const parsed = parseSetting(value, index, diagnostics, "settings");
    if (parsed) {
      settings.push(parsed);
    }
  }

  const blocks: LiquidSchemaBlockDefinition[] = [];
  for (const [index, value] of blocksRaw.entries()) {
    const parsed = parseBlockDefinition(value, index, diagnostics);
    if (parsed) {
      blocks.push(parsed);
    }
  }

  const presets: LiquidSchemaPreset[] = [];
  for (const [index, value] of presetsRaw.entries()) {
    const parsed = parsePreset(value, index, diagnostics);
    if (parsed) {
      presets.push(parsed);
    }
  }

  const schema: LiquidSchema = {
    name: asString(schemaObject.name) ?? "Untitled component",
    settings,
    blocks,
    presets,
    raw: schemaObject,
  };

  return {
    schema,
    diagnostics,
    blockMatch,
  };
}
