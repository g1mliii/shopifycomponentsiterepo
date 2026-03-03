export type LiquidSchemaDiagnosticLevel = "info" | "warning" | "error";

export interface LiquidSchemaDiagnostic {
  code: string;
  level: LiquidSchemaDiagnosticLevel;
  message: string;
  path?: string;
}

export type LiquidSettingSupport = "native" | "simulated" | "unknown";

export type LiquidSettingJsonValue =
  | string
  | number
  | boolean
  | null
  | LiquidSettingJsonValue[]
  | { [key: string]: LiquidSettingJsonValue };

export interface LiquidSchemaOption {
  value: string;
  label: string;
}

export interface LiquidSchemaSetting {
  id: string;
  type: string;
  label: string;
  defaultValue: LiquidSettingJsonValue;
  support: LiquidSettingSupport;
  options: LiquidSchemaOption[];
  min: number | null;
  max: number | null;
  step: number | null;
  placeholder: string | null;
  info: string | null;
  raw: Record<string, unknown>;
}

export interface LiquidSchemaBlockDefinition {
  type: string;
  name: string;
  limit: number | null;
  settings: LiquidSchemaSetting[];
  raw: Record<string, unknown>;
}

export interface LiquidSchemaPresetBlock {
  type: string;
  settings: Record<string, LiquidSettingJsonValue>;
  raw: Record<string, unknown>;
}

export interface LiquidSchemaPreset {
  name: string;
  blocks: LiquidSchemaPresetBlock[];
  raw: Record<string, unknown>;
}

export interface LiquidSchema {
  name: string;
  settings: LiquidSchemaSetting[];
  blocks: LiquidSchemaBlockDefinition[];
  presets: LiquidSchemaPreset[];
  raw: Record<string, unknown>;
}

export interface LiquidSchemaBlockMatch {
  raw: string;
  json: string;
  fullStart: number;
  fullEnd: number;
  jsonStart: number;
  jsonEnd: number;
}

export interface ParsedLiquidSchemaResult {
  schema: LiquidSchema | null;
  diagnostics: LiquidSchemaDiagnostic[];
  blockMatch: LiquidSchemaBlockMatch | null;
}

export interface LiquidBlockInstance {
  id: string;
  type: string;
  settings: Record<string, LiquidSettingJsonValue>;
}

export interface LiquidEditorState {
  sectionSettings: Record<string, LiquidSettingJsonValue>;
  blocks: LiquidBlockInstance[];
}
