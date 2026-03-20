"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";

import { getSettingControlSpec } from "@/lib/liquid/schema-controls";
import { getPlainLanguageSettingLabel, getSettingJargonHint } from "@/lib/liquid/setting-labels";
import type { LiquidSchemaSetting, LiquidSettingJsonValue } from "@/lib/liquid/schema-types";

export type SettingControlProps = {
  setting: LiquidSchemaSetting;
  value: LiquidSettingJsonValue;
  pathKey: string;
  conditionalHints?: string[];
  onChange: (pathKey: string, nextValue: LiquidSettingJsonValue) => void;
  onSelectLocalMedia: (pathKey: string, file: File | null) => void;
};

function toInputValue(value: LiquidSettingJsonValue): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function isRecordValue(value: LiquidSettingJsonValue): value is Record<string, LiquidSettingJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: LiquidSettingJsonValue): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : toInputValue(entry).trim()))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

type SimulatedResourceShape = {
  handle: string;
  title: string;
  url: string;
};

type SimulatedMetaobjectShape = {
  type: string;
  handle: string;
  id: string;
};

type SimulatedMenuShape = {
  handle: string;
  links: string[];
};

const SIMULATED_RESOURCE_HANDLE_PLACEHOLDERS: Record<string, string> = {
  article: "articles/example-article",
  blog: "blogs/example-blog",
  collection: "collections/example-collection",
  page: "pages/example-page",
  product: "products/example-product",
};

const SIMULATED_RESOURCE_LIST_PLACEHOLDERS: Record<string, string> = {
  collection_list: "collections/my-collection",
  metaobject_list: "custom.sample/my-entry",
  product_list: "products/my-product",
};

function getResourceHandlePlaceholder(settingType: string): string {
  return SIMULATED_RESOURCE_HANDLE_PLACEHOLDERS[settingType] ?? "resources/example-handle";
}

function getMetaobjectTypeFromSetting(setting: LiquidSchemaSetting): string {
  const rawMetaobjectType = setting.raw.metaobject_type;
  if (typeof rawMetaobjectType !== "string") {
    return "custom.sample";
  }

  const normalized = rawMetaobjectType.trim();
  return normalized.length > 0 ? normalized : "custom.sample";
}

function getResourceListPlaceholder(settingType: string, setting: LiquidSchemaSetting): string {
  if (settingType === "metaobject_list") {
    return `${getMetaobjectTypeFromSetting(setting)}/my-entry`;
  }

  return SIMULATED_RESOURCE_LIST_PLACEHOLDERS[settingType] ?? "resources/my-handle";
}

function toSelectFallbackLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function toSimulatedResourceShape(value: LiquidSettingJsonValue): SimulatedResourceShape {
  if (isRecordValue(value)) {
    return {
      handle: typeof value.handle === "string" ? value.handle : "",
      title: typeof value.title === "string" ? value.title : "",
      url: typeof value.url === "string" ? value.url : "",
    };
  }

  if (typeof value === "string") {
    return {
      handle: value,
      title: "",
      url: "",
    };
  }

  return {
    handle: "",
    title: "",
    url: "",
  };
}

function toSimulatedMetaobjectShape(value: LiquidSettingJsonValue): SimulatedMetaobjectShape {
  if (isRecordValue(value)) {
    return {
      type: typeof value.type === "string" ? value.type : "",
      handle: typeof value.handle === "string" ? value.handle : "",
      id: typeof value.id === "string" ? value.id : "",
    };
  }

  return {
    type: "",
    handle: "",
    id: "",
  };
}

function toSimulatedMenuShape(value: LiquidSettingJsonValue): SimulatedMenuShape {
  if (isRecordValue(value)) {
    const linksValue = value.links;
    return {
      handle: typeof value.handle === "string" ? value.handle : "",
      links: Array.isArray(linksValue) ? toStringArray(linksValue as LiquidSettingJsonValue) : [],
    };
  }

  if (typeof value === "string") {
    return {
      handle: value,
      links: [],
    };
  }

  return {
    handle: "",
    links: [],
  };
}

type SimulatedEditorProps = {
  setting: LiquidSchemaSetting;
  pathKey: string;
  value: LiquidSettingJsonValue;
  onChange: (pathKey: string, nextValue: LiquidSettingJsonValue) => void;
};

const SimulatedResourceEditor = memo(function SimulatedResourceEditor({
  setting,
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const settingType = setting.type.toLowerCase();
  const normalized = toSimulatedResourceShape(value);
  const inputClass = "sandbox-input sandbox-focus-ring mt-1";

  const apply = useCallback(
    (patch: Partial<SimulatedResourceShape>) => {
      onChange(pathKey, {
        handle: patch.handle ?? normalized.handle,
        title: patch.title ?? normalized.title,
        url: patch.url ?? normalized.url,
      });
    },
    [normalized.handle, normalized.title, normalized.url, onChange, pathKey],
  );

  return (
    <div className="sandbox-card-soft mt-2 p-3">
      <label className="sandbox-muted block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:handle`}>
        Resource Handle / ID
      </label>
      <input
        id={`${pathKey}:handle`}
        type="text"
        value={normalized.handle}
        placeholder={getResourceHandlePlaceholder(settingType)}
        onChange={(event) => apply({ handle: event.target.value })}
        className={inputClass}
      />
      <label className="sandbox-muted mt-2 block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:title`}>
        Resource Title
      </label>
      <input
        id={`${pathKey}:title`}
        type="text"
        value={normalized.title}
        placeholder="Optional title for preview context"
        onChange={(event) => apply({ title: event.target.value })}
        className={inputClass}
      />
      <label className="sandbox-muted mt-2 block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:url`}>
        Resource URL
      </label>
      <input
        id={`${pathKey}:url`}
        type="text"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={normalized.url}
        placeholder="https://example.test/resource"
        onChange={(event) => apply({ url: event.target.value })}
        className={inputClass}
      />
      <p className="sandbox-muted mt-2 text-xs">Sandbox picker values are stored as a lightweight object.</p>
    </div>
  );
});

const SimulatedMetaobjectEditor = memo(function SimulatedMetaobjectEditor({
  setting,
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const metaobjectType = getMetaobjectTypeFromSetting(setting);
  const normalized = toSimulatedMetaobjectShape(value);
  const inputClass = "sandbox-input sandbox-focus-ring mt-1";

  const apply = useCallback(
    (patch: Partial<SimulatedMetaobjectShape>) => {
      onChange(pathKey, {
        type: patch.type ?? normalized.type,
        handle: patch.handle ?? normalized.handle,
        id: patch.id ?? normalized.id,
      });
    },
    [normalized.handle, normalized.id, normalized.type, onChange, pathKey],
  );

  return (
    <div className="sandbox-card-soft mt-2 p-3">
      <label className="sandbox-muted block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:type`}>
        Metaobject Type
      </label>
      <input
        id={`${pathKey}:type`}
        type="text"
        value={normalized.type}
        placeholder={metaobjectType}
        onChange={(event) => apply({ type: event.target.value })}
        className={inputClass}
      />
      <label className="sandbox-muted mt-2 block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:handle`}>
        Handle
      </label>
      <input
        id={`${pathKey}:handle`}
        type="text"
        value={normalized.handle}
        placeholder="metaobject-handle"
        onChange={(event) => apply({ handle: event.target.value })}
        className={inputClass}
      />
      <label className="sandbox-muted mt-2 block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:id`}>
        ID
      </label>
      <input
        id={`${pathKey}:id`}
        type="text"
        value={normalized.id}
        placeholder="gid://shopify/Metaobject/123"
        onChange={(event) => apply({ id: event.target.value })}
        className={inputClass}
      />
      <p className="sandbox-muted mt-2 text-xs">Metaobject values are editable for patch and preview tests.</p>
    </div>
  );
});

const SimulatedResourceListEditor = memo(function SimulatedResourceListEditor({
  setting,
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const settingType = setting.type.toLowerCase();
  const draftPlaceholder = useMemo(
    () => getResourceListPlaceholder(settingType, setting),
    [setting, settingType],
  );
  const [draft, setDraft] = useState("");
  const entries = toStringArray(value);
  const inputClass = "sandbox-input sandbox-focus-ring mt-1";

  const addDraft = useCallback(() => {
    const normalized = draft.trim();
    if (!normalized) {
      return;
    }

    onChange(pathKey, [...entries, normalized]);
    setDraft("");
  }, [draft, entries, onChange, pathKey]);

  return (
    <div className="sandbox-card-soft mt-2 p-3">
      <label className="sandbox-muted block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:draft`}>
        Add Reference
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`${pathKey}:draft`}
          type="text"
          value={draft}
          placeholder={draftPlaceholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            addDraft();
          }}
          className={inputClass}
        />
        <button
          type="button"
          onClick={addDraft}
          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-10 px-3 text-xs"
        >
          Add
        </button>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {entries.map((entry, index) => (
            <li
              key={`${entry}-${index}`}
              className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs"
              style={{
                borderColor: "color-mix(in srgb, var(--color-bark) 24%, var(--color-timber))",
                background: "var(--color-card)",
                color: "var(--color-bark)",
              }}
            >
              <span>{entry}</span>
              <button
                type="button"
                onClick={() => onChange(pathKey, entries.filter((_item, itemIndex) => itemIndex !== index))}
                className="sandbox-focus-ring rounded px-1"
                style={{ color: "var(--color-muted-fg)" }}
                aria-label={`Remove ${entry}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sandbox-muted mt-2 text-xs">No references added yet.</p>
      )}
    </div>
  );
});

const SimulatedMenuEditor = memo(function SimulatedMenuEditor({
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const normalized = toSimulatedMenuShape(value);
  const inputClass = "sandbox-input sandbox-focus-ring mt-1";

  return (
    <div className="sandbox-card-soft mt-2 p-3">
      <label className="sandbox-muted block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:menu-handle`}>
        Menu Handle
      </label>
      <input
        id={`${pathKey}:menu-handle`}
        type="text"
        value={normalized.handle}
        placeholder="main-menu"
        onChange={(event) =>
          onChange(pathKey, {
            ...normalized,
            handle: event.target.value,
          })
        }
        className={inputClass}
      />

      <label className="sandbox-muted mt-2 block text-xs font-medium uppercase tracking-wide" htmlFor={`${pathKey}:menu-links`}>
        Mock Links (comma or newline separated)
      </label>
      <textarea
        id={`${pathKey}:menu-links`}
        value={normalized.links.join("\n")}
        rows={3}
        onChange={(event) =>
          onChange(pathKey, {
            ...normalized,
            links: toStringArray(event.target.value),
          })
        }
        className={inputClass}
      />
      <p className="sandbox-muted mt-2 text-xs">Menu links are editable in this standalone sandbox.</p>
    </div>
  );
});

function areConditionalHintsEqual(previous?: string[], next?: string[]): boolean {
  if (previous === next) {
    return true;
  }

  if (!previous || !next || previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }

  return true;
}

function areSettingControlPropsEqual(previous: SettingControlProps, next: SettingControlProps): boolean {
  return (
    previous.setting === next.setting
    && Object.is(previous.value, next.value)
    && previous.pathKey === next.pathKey
    && previous.onChange === next.onChange
    && previous.onSelectLocalMedia === next.onSelectLocalMedia
    && areConditionalHintsEqual(previous.conditionalHints, next.conditionalHints)
  );
}

export const SettingControl = memo(function SettingControl({
  setting,
  value,
  pathKey,
  conditionalHints,
  onChange,
  onSelectLocalMedia,
}: SettingControlProps) {
  const localMediaInputRef = useRef<HTMLInputElement | null>(null);
  const control = getSettingControlSpec(setting);
  const displayLabel = getPlainLanguageSettingLabel(setting.label);
  const jargonHint = getSettingJargonHint(setting.label);
  const conditionalHintText = useMemo(() => {
    if (!conditionalHints || conditionalHints.length === 0) {
      return null;
    }

    const normalized = Array.from(
      new Set(
        conditionalHints
          .map((hint) => hint.trim())
          .filter((hint) => hint.length > 0),
      ),
    );
    if (normalized.length === 0) {
      return null;
    }

    return normalized.join(" ");
  }, [conditionalHints]);

  const sharedInputClass = "sandbox-input sandbox-focus-ring mt-1";
  const selectOptions = useMemo(() => {
    if (control.kind !== "select") {
      return [];
    }

    if (setting.options.length > 0) {
      return setting.options;
    }

    if (setting.type.toLowerCase() !== "color_scheme") {
      return [];
    }

    const nextOptions = new Set<string>();
    const defaultValue = toInputValue(setting.defaultValue).trim();
    const currentValue = toInputValue(value).trim();

    if (defaultValue) {
      nextOptions.add(defaultValue);
    }
    if (currentValue) {
      nextOptions.add(currentValue);
    }

    for (let index = 1; index <= 8; index += 1) {
      nextOptions.add(`scheme_${index}`);
    }

    return Array.from(nextOptions).map((optionValue) => ({
      value: optionValue,
      label: toSelectFallbackLabel(optionValue),
    }));
  }, [control.kind, setting.defaultValue, setting.options, setting.type, value]);

  return (
    <div className="sandbox-card p-3">
      <div className="flex items-center justify-between gap-3">
        <label
          className="sandbox-title text-sm font-medium"
          htmlFor={pathKey}
          title={displayLabel !== setting.label ? `Schema label: ${setting.label}` : undefined}
        >
          {displayLabel}
        </label>
        {control.simulated ? (
          <span className="sandbox-badge sandbox-badge-simulated">
            Simulated
          </span>
        ) : null}
        {control.unknown ? (
          <span className="sandbox-badge sandbox-badge-unknown">
            Unknown
          </span>
        ) : null}
      </div>
      {jargonHint ? <p className="sandbox-muted mt-1 text-xs">{jargonHint}</p> : null}
      {setting.info ? <p className="sandbox-muted mt-1 text-xs">{setting.info}</p> : null}
      {conditionalHintText ? (
        <p className="sandbox-card-warn mt-1 px-2 py-1 text-xs" style={{ borderRadius: "0.6rem", color: "#704322" }}>
          {conditionalHintText}
        </p>
      ) : null}

      {control.kind === "checkbox" ? (
        <div className="mt-2">
          <input
            id={pathKey}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(pathKey, event.target.checked)}
            className="sandbox-focus-ring h-4 w-4 rounded"
            style={{
              borderColor: "color-mix(in srgb, var(--color-bark) 24%, var(--color-timber))",
              color: "var(--foreground)",
            }}
          />
        </div>
      ) : null}

      {control.kind === "range" ? (
        <div className="mt-2">
          <input
            id={pathKey}
            type="range"
            min={setting.min ?? 0}
            max={setting.max ?? 100}
            step={setting.step ?? 1}
            value={typeof value === "number" ? value : Number.parseFloat(toInputValue(value)) || 0}
            onChange={(event) => onChange(pathKey, Number.parseFloat(event.target.value) || 0)}
            className="block w-full touch-manipulation"
            style={{ accentColor: "var(--color-moss)" }}
          />
          <p className="sandbox-muted mt-1 text-xs">Value: {toInputValue(value)}</p>
        </div>
      ) : null}

      {control.kind === "number" ? (
        <input
          id={pathKey}
          type="number"
          min={setting.min ?? undefined}
          max={setting.max ?? undefined}
          step={setting.step ?? undefined}
          value={toInputValue(value)}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value);
            onChange(pathKey, Number.isFinite(parsed) ? parsed : 0);
          }}
          className={sharedInputClass}
        />
      ) : null}

      {control.kind === "color" ? (
        <input
          id={pathKey}
          type="color"
          value={toInputValue(value) || "#000000"}
          onChange={(event) => onChange(pathKey, event.target.value)}
          className="sandbox-focus-ring mt-1 h-10 w-20 rounded border bg-white"
          style={{ borderColor: "color-mix(in srgb, var(--color-bark) 24%, var(--color-timber))" }}
        />
      ) : null}

      {control.kind === "select" ? (
        selectOptions.length > 0 ? (
          <select
            id={pathKey}
            value={toInputValue(value)}
            onChange={(event) => onChange(pathKey, event.target.value)}
            className={sharedInputClass}
          >
            {selectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-2">
            <input
              id={pathKey}
              type="text"
              value={toInputValue(value)}
              placeholder={setting.placeholder ?? ""}
              onChange={(event) => onChange(pathKey, event.target.value)}
              className={sharedInputClass}
            />
            <p className="sandbox-muted mt-1 text-xs">No selectable options were provided in schema; using text fallback.</p>
          </div>
        )
      ) : null}

      {control.kind === "textarea" ? (
        <textarea
          id={pathKey}
          value={toInputValue(value)}
          onChange={(event) => onChange(pathKey, event.target.value)}
          rows={4}
          className={sharedInputClass}
        />
      ) : null}

      {control.kind === "json" ? (
        <div className="mt-2">
          <textarea
            id={pathKey}
            value={toInputValue(value)}
            rows={4}
            onChange={(event) => {
              const nextValue = event.target.value;
              try {
                const parsed = JSON.parse(nextValue) as LiquidSettingJsonValue;
                onChange(pathKey, parsed);
              } catch {
                onChange(pathKey, nextValue);
              }
            }}
            className={sharedInputClass}
          />
          <p className="sandbox-muted mt-1 text-xs">JSON values are simulated in sandbox mode.</p>
        </div>
      ) : null}

      {control.kind === "simulated_resource" ? (
        <SimulatedResourceEditor setting={setting} pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "simulated_resource_list" ? (
        <SimulatedResourceListEditor setting={setting} pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "simulated_metaobject" ? (
        <SimulatedMetaobjectEditor setting={setting} pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "simulated_menu" ? (
        <SimulatedMenuEditor setting={setting} pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "text" || control.kind === "url" ? (
        <input
          id={pathKey}
          type={control.inputType}
          inputMode={control.kind === "url" ? "url" : undefined}
          autoCapitalize={control.kind === "url" ? "off" : undefined}
          autoCorrect={control.kind === "url" ? "off" : undefined}
          spellCheck={control.kind === "url" ? false : undefined}
          value={toInputValue(value)}
          placeholder={setting.placeholder ?? ""}
          onChange={(event) => onChange(pathKey, event.target.value)}
          className={sharedInputClass}
        />
      ) : null}

      {control.supportsLocalFilePreview ? (
        <div className="mt-2">
          <label className="block text-xs font-medium" style={{ color: "var(--color-bark)" }} htmlFor={`${pathKey}:file`}>
            Local preview file (not persisted)
          </label>
          <input
            ref={localMediaInputRef}
            id={`${pathKey}:file`}
            type="file"
            accept="image/*,video/*"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onSelectLocalMedia(pathKey, file);
            }}
            className="sandbox-input sandbox-focus-ring mt-1 block w-full px-2 py-1 text-xs file:mr-3 file:rounded-full file:border file:px-3 file:py-1 file:text-xs file:font-semibold"
            style={{
              color: "var(--color-bark)",
              borderColor: "color-mix(in srgb, var(--color-bark) 24%, var(--color-timber))",
            }}
          />
          <button
            type="button"
            onClick={() => {
              onSelectLocalMedia(pathKey, null);
              if (localMediaInputRef.current) {
                localMediaInputRef.current.value = "";
              }
            }}
            className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring mt-2 h-8 rounded-lg px-2 text-xs"
          >
            Clear Local Preview
          </button>
        </div>
      ) : null}
    </div>
  );
}, areSettingControlPropsEqual);
