import type { LiquidSchemaDiagnostic } from "./schema-types";

const UPLOAD_BLOCKING_DIAGNOSTIC_CODES = new Set<string>([
  "duplicate_setting_id",
  "duplicate_block_type",
  "unknown_section_setting_reference",
  "unknown_block_setting_reference",
  "unknown_preset_block_type",
  "unknown_preset_block_setting",
]);
const UPLOAD_SUGGESTION_DIAGNOSTIC_CODES = new Set<string>([
  "unused_section_setting",
  "unused_block_setting",
]);

function formatDiagnosticLabel(code: string): string {
  if (code === "duplicate_setting_id") {
    return "duplicate setting IDs";
  }

  if (code === "duplicate_block_type") {
    return "duplicate block types";
  }

  if (code === "unknown_section_setting_reference" || code === "unknown_block_setting_reference") {
    return "Liquid references that are missing from the schema";
  }

  if (code === "unknown_preset_block_type" || code === "unknown_preset_block_setting") {
    return "preset blocks that do not match the schema";
  }

  return "schema issues";
}

export function getUploadBlockingSchemaDiagnostics(
  diagnostics: LiquidSchemaDiagnostic[],
): LiquidSchemaDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    return diagnostic.level === "error" || UPLOAD_BLOCKING_DIAGNOSTIC_CODES.has(diagnostic.code);
  });
}

export function getUploadBlockingSchemaMessage(
  diagnostics: LiquidSchemaDiagnostic[],
): string | null {
  const blockingDiagnostics = getUploadBlockingSchemaDiagnostics(diagnostics);
  const firstDiagnostic = blockingDiagnostics[0];
  if (!firstDiagnostic) {
    return null;
  }

  if (firstDiagnostic.code === "duplicate_setting_id") {
    return "This Liquid file has duplicate setting IDs. Fix the duplicated ids in the file, then upload the corrected .liquid file.";
  }

  if (UPLOAD_BLOCKING_DIAGNOSTIC_CODES.has(firstDiagnostic.code)) {
    return `This Liquid file has blocking ${formatDiagnosticLabel(firstDiagnostic.code)}. Fix the file, then upload a corrected .liquid file.`;
  }

  if (firstDiagnostic.level === "error") {
    return `This Liquid file has blocking ${formatDiagnosticLabel(firstDiagnostic.code)}. Fix the file, then upload a corrected .liquid file.`;
  }

  return "This Liquid file has blocking schema issues. Fix the file, then upload a corrected .liquid file.";
}

export function getUploadSuggestionSchemaDiagnostics(
  diagnostics: LiquidSchemaDiagnostic[],
): LiquidSchemaDiagnostic[] {
  return diagnostics.filter((diagnostic) => UPLOAD_SUGGESTION_DIAGNOSTIC_CODES.has(diagnostic.code));
}

export function getUploadSuggestionSchemaMessage(
  diagnostics: LiquidSchemaDiagnostic[],
): string | null {
  const suggestionDiagnostics = getUploadSuggestionSchemaDiagnostics(diagnostics);
  if (suggestionDiagnostics.length === 0) {
    return null;
  }

  return "This Liquid file has non-blocking schema suggestions, such as settings declared in schema but not used in the template. You can still upload it, but it is worth cleaning up.";
}
