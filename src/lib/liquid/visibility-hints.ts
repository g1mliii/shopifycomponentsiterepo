import type { LiquidSchemaSetting, LiquidSettingJsonValue } from "./schema-types";

const visibilityToggleCache = new WeakMap<
  Map<string, LiquidSchemaSetting>,
  Map<string, LiquidSchemaSetting | null>
>();

function normalizeLabelWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toPlainLanguageLabel(label: string): string {
  const normalized = normalizeLabelWhitespace(label);
  if (!normalized) {
    return normalized;
  }

  let next = normalized;
  next = next.replace(/\bCTA\s+Label\b/gi, "Button Text");
  next = next.replace(/\bCTA\s+(URL|Link)\b/gi, "Button Link");
  next = next.replace(/\bCTA\b/gi, "Button");
  next = next.replace(/\bURL\b/g, "Link");
  next = next.replace(/\bEyebrow\b/gi, "Small Heading");
  next = next.replace(/\bKicker\b/gi, "Small Heading");

  return normalizeLabelWhitespace(next);
}

function hasDisplayValue(value: LiquidSettingJsonValue | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return Object.keys(value).length > 0;
}

function isLabelLikeSetting(setting: LiquidSchemaSetting): boolean {
  const type = setting.type.toLowerCase();
  if (type !== "text" && type !== "inline_richtext" && type !== "textarea") {
    return false;
  }

  const id = setting.id.toLowerCase();
  return id === "label" || id.endsWith("_label") || id.endsWith("label");
}

function addUrlCandidatesFromBase(candidates: Set<string>, base: string): void {
  if (!base) {
    return;
  }

  candidates.add(base);
  candidates.add(`${base}_url`);
  candidates.add(`${base}_link`);
  candidates.add(`${base}_href`);
}

function isLinkLikeSetting(setting: LiquidSchemaSetting): boolean {
  const type = setting.type.toLowerCase();
  if (type === "url" || type === "video" || type === "video_url") {
    return true;
  }

  const id = setting.id.toLowerCase();
  return id === "url" || id === "link" || id.endsWith("_url") || id.endsWith("_link");
}

function resolveLinkedUrlSetting(
  labelSetting: LiquidSchemaSetting,
  settingLookup: Map<string, LiquidSchemaSetting>,
): LiquidSchemaSetting | null {
  const labelId = labelSetting.id.toLowerCase();
  const candidates = new Set<string>();

  if (labelId === "label") {
    candidates.add("url");
    candidates.add("link");
    candidates.add("href");
  }

  if (labelId.endsWith("_label")) {
    addUrlCandidatesFromBase(candidates, labelId.slice(0, -"_label".length));
    candidates.add(labelId.replace(/_label$/, "_url"));
    candidates.add(labelId.replace(/_label$/, "_link"));
  }

  if (labelId.endsWith("label")) {
    const trimmedBase = labelId.slice(0, -"label".length).replace(/[_-]+$/, "");
    addUrlCandidatesFromBase(candidates, trimmedBase);
  }

  for (const candidate of candidates) {
    const linked = settingLookup.get(candidate);
    if (!linked) {
      continue;
    }

    if (isLinkLikeSetting(linked)) {
      return linked;
    }
  }

  return null;
}

export function buildSettingLookup(settings: LiquidSchemaSetting[]): Map<string, LiquidSchemaSetting> {
  const lookup = new Map<string, LiquidSchemaSetting>();
  for (const setting of settings) {
    lookup.set(setting.id.toLowerCase(), setting);
  }
  return lookup;
}

function isAltLikeSetting(setting: LiquidSchemaSetting): boolean {
  const type = setting.type.toLowerCase();
  if (type !== "text" && type !== "inline_richtext" && type !== "textarea") {
    return false;
  }

  const id = setting.id.toLowerCase();
  return id === "alt" || id.endsWith("_alt") || id.endsWith("_alt_text");
}

function isMediaSetting(setting: LiquidSchemaSetting): boolean {
  const type = setting.type.toLowerCase();
  return type === "image_picker" || type === "video" || type === "video_url";
}

function resolveLinkedMediaSetting(
  altSetting: LiquidSchemaSetting,
  settingLookup: Map<string, LiquidSchemaSetting>,
): LiquidSchemaSetting | null {
  const id = altSetting.id.toLowerCase();
  const candidates = new Set<string>();

  if (id === "alt") {
    candidates.add("image");
    candidates.add("video");
    candidates.add("media");
  }

  if (id.endsWith("_alt_text")) {
    const base = id.slice(0, -"_alt_text".length);
    candidates.add(base);
    candidates.add(`${base}_image`);
    candidates.add(`${base}_video`);
  }

  if (id.endsWith("_alt")) {
    const base = id.slice(0, -"_alt".length);
    candidates.add(base);
    candidates.add(`${base}_image`);
    candidates.add(`${base}_video`);
    candidates.add(`${base}_media`);
  }

  for (const candidate of candidates) {
    const linked = settingLookup.get(candidate);
    if (!linked) {
      continue;
    }
    if (isMediaSetting(linked)) {
      return linked;
    }
  }

  return null;
}

function resolveVisibilityToggleSetting(
  setting: LiquidSchemaSetting,
  settingLookup: Map<string, LiquidSchemaSetting>,
): LiquidSchemaSetting | null {
  const id = setting.id.toLowerCase();
  let bestMatch: LiquidSchemaSetting | null = null;
  let bestTokenLength = -1;

  for (const candidate of settingLookup.values()) {
    if (candidate.type.toLowerCase() !== "checkbox") {
      continue;
    }

    const toggleId = candidate.id.toLowerCase();
    const tokenMatch = /^(show|enable)_(.+)$/.exec(toggleId);
    if (!tokenMatch) {
      continue;
    }

    const token = tokenMatch[2] ?? "";
    if (!token) {
      continue;
    }

    const relates =
      id === token ||
      id.startsWith(`${token}_`) ||
      id.endsWith(`_${token}`) ||
      id.includes(`_${token}_`);

    if (!relates) {
      continue;
    }

    if (token.length > bestTokenLength) {
      bestMatch = candidate;
      bestTokenLength = token.length;
    }
  }

  return bestMatch;
}

function resolveVisibilityToggleSettingCached(
  setting: LiquidSchemaSetting,
  settingLookup: Map<string, LiquidSchemaSetting>,
): LiquidSchemaSetting | null {
  let cacheBySettingId = visibilityToggleCache.get(settingLookup);
  if (!cacheBySettingId) {
    cacheBySettingId = new Map<string, LiquidSchemaSetting | null>();
    visibilityToggleCache.set(settingLookup, cacheBySettingId);
  }

  const normalizedId = setting.id.toLowerCase();
  if (cacheBySettingId.has(normalizedId)) {
    return cacheBySettingId.get(normalizedId) ?? null;
  }

  const resolved = resolveVisibilityToggleSetting(setting, settingLookup);
  cacheBySettingId.set(normalizedId, resolved);
  return resolved;
}

export function getConditionalVisibilityHints(
  setting: LiquidSchemaSetting,
  value: LiquidSettingJsonValue | undefined,
  valuesBySettingId: Record<string, LiquidSettingJsonValue>,
  settingLookup: Map<string, LiquidSchemaSetting>,
): string[] {
  const hints: string[] = [];

  if (isLabelLikeSetting(setting) && hasDisplayValue(value)) {
    const linkedUrlSetting = resolveLinkedUrlSetting(setting, settingLookup);
    if (linkedUrlSetting) {
      const linkedValue = valuesBySettingId[linkedUrlSetting.id];
      if (!hasDisplayValue(linkedValue)) {
        hints.push(
          `Preview may hide this label until "${toPlainLanguageLabel(linkedUrlSetting.label)}" is set.`,
        );
      }
    }
  }

  if (isAltLikeSetting(setting) && hasDisplayValue(value)) {
    const linkedMediaSetting = resolveLinkedMediaSetting(setting, settingLookup);
    if (linkedMediaSetting) {
      const linkedValue = valuesBySettingId[linkedMediaSetting.id];
      if (!hasDisplayValue(linkedValue)) {
        hints.push(
          `Preview may hide this alt text until "${toPlainLanguageLabel(linkedMediaSetting.label)}" has a value.`,
        );
      }
    }
  }

  if (hasDisplayValue(value)) {
    const visibilityToggle = resolveVisibilityToggleSettingCached(setting, settingLookup);
    if (visibilityToggle) {
      const toggleValue = valuesBySettingId[visibilityToggle.id];
      if (toggleValue === false) {
        hints.push(
          `Preview may hide this field while "${toPlainLanguageLabel(visibilityToggle.label)}" is disabled.`,
        );
      }
    }
  }

  return hints;
}
