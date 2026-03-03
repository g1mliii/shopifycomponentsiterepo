import type { LiquidSchemaSetting } from "./schema-types";

export type LiquidControlKind =
  | "checkbox"
  | "color"
  | "number"
  | "range"
  | "select"
  | "simulated_menu"
  | "simulated_metaobject"
  | "simulated_resource"
  | "simulated_resource_list"
  | "text"
  | "textarea"
  | "url"
  | "json";

export interface LiquidControlSpec {
  kind: LiquidControlKind;
  inputType: string;
  simulated: boolean;
  unknown: boolean;
  supportsLocalFilePreview: boolean;
}

const TEXT_AREA_TYPES = new Set(["textarea", "richtext", "html", "inline_richtext", "liquid"]);
const NUMERIC_TYPES = new Set(["number"]);
const SELECT_TYPES = new Set(["select", "radio", "color_scheme", "text_alignment", "font_picker"]);
const URL_TYPES = new Set(["url", "video_url", "video"]);
const JSON_TYPES = new Set(["collection_list", "metaobject_list", "product_list"]);
const LOCAL_FILE_PREVIEW_TYPES = new Set(["image_picker", "video", "video_url"]);
const SIMULATED_RESOURCE_TYPES = new Set(["product", "collection", "article", "blog", "page"]);
const SIMULATED_RESOURCE_LIST_TYPES = new Set(["product_list", "collection_list", "metaobject_list"]);

export function getSettingControlSpec(setting: LiquidSchemaSetting): LiquidControlSpec {
  const type = setting.type.toLowerCase();

  if (type === "metaobject") {
    return {
      kind: "simulated_metaobject",
      inputType: "text",
      simulated: true,
      unknown: false,
      supportsLocalFilePreview: false,
    };
  }

  if (type === "link_list") {
    return {
      kind: "simulated_menu",
      inputType: "text",
      simulated: true,
      unknown: false,
      supportsLocalFilePreview: false,
    };
  }

  if (SIMULATED_RESOURCE_LIST_TYPES.has(type)) {
    return {
      kind: "simulated_resource_list",
      inputType: "text",
      simulated: true,
      unknown: false,
      supportsLocalFilePreview: false,
    };
  }

  if (SIMULATED_RESOURCE_TYPES.has(type)) {
    return {
      kind: "simulated_resource",
      inputType: "text",
      simulated: true,
      unknown: false,
      supportsLocalFilePreview: false,
    };
  }

  if (type === "checkbox") {
    return {
      kind: "checkbox",
      inputType: "checkbox",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: false,
    };
  }

  if (type === "range") {
    return {
      kind: "range",
      inputType: "range",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: false,
    };
  }

  if (type === "color" || type === "color_background") {
    return {
      kind: "color",
      inputType: "color",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: false,
    };
  }

  if (NUMERIC_TYPES.has(type)) {
    return {
      kind: "number",
      inputType: "number",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: false,
    };
  }

  if (SELECT_TYPES.has(type) || setting.options.length > 0) {
    return {
      kind: "select",
      inputType: "select",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: false,
    };
  }

  if (TEXT_AREA_TYPES.has(type)) {
    return {
      kind: "textarea",
      inputType: "textarea",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: false,
    };
  }

  if (URL_TYPES.has(type)) {
    return {
      kind: "url",
      inputType: "url",
      simulated: setting.support === "simulated",
      unknown: setting.support === "unknown",
      supportsLocalFilePreview: LOCAL_FILE_PREVIEW_TYPES.has(type),
    };
  }

  if (JSON_TYPES.has(type)) {
    return {
      kind: "json",
      inputType: "textarea",
      simulated: true,
      unknown: false,
      supportsLocalFilePreview: false,
    };
  }

  if (type === "image_picker") {
    return {
      kind: "url",
      inputType: "url",
      simulated: false,
      unknown: false,
      supportsLocalFilePreview: true,
    };
  }

  if (setting.support === "unknown") {
    return {
      kind: "json",
      inputType: "textarea",
      simulated: false,
      unknown: true,
      supportsLocalFilePreview: false,
    };
  }

  return {
    kind: "text",
    inputType: "text",
    simulated: setting.support === "simulated",
    unknown: false,
    supportsLocalFilePreview: false,
  };
}
