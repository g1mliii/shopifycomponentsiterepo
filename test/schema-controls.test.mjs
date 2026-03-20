import assert from "node:assert/strict";
import test from "node:test";

import { getSettingControlSpec } from "../src/lib/liquid/schema-controls.ts";

function createSetting(overrides = {}) {
  return {
    id: "setting_id",
    type: "text",
    label: "Setting",
    defaultValue: "",
    support: "native",
    options: [],
    min: null,
    max: null,
    step: null,
    placeholder: null,
    info: null,
    raw: {},
    ...overrides,
  };
}

test("color_scheme remains a select control even without explicit options", () => {
  const setting = createSetting({
    type: "color_scheme",
    defaultValue: "scheme_1",
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "select");
});

test("unknown settings with scalar defaults use text fallback", () => {
  const setting = createSetting({
    type: "future_setting_type",
    support: "unknown",
    defaultValue: "experimental",
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "text");
  assert.equal(spec.unknown, true);
});

test("unknown settings with object defaults use json fallback", () => {
  const setting = createSetting({
    type: "future_setting_type",
    support: "unknown",
    defaultValue: { enabled: true },
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "json");
  assert.equal(spec.unknown, true);
});

test("resource picker controls are treated as supported sandbox controls", () => {
  const setting = createSetting({
    type: "product",
    support: "native",
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "simulated_resource");
  assert.equal(spec.simulated, false);
  assert.equal(spec.unknown, false);
});

test("text media URL settings support local file preview input", () => {
  const setting = createSetting({
    id: "video_url",
    type: "text",
    label: "Video URL",
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "text");
  assert.equal(spec.supportsLocalFilePreview, true);
});

test("generic text settings do not expose local file preview input", () => {
  const setting = createSetting({
    id: "heading",
    type: "text",
    label: "Heading",
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "text");
  assert.equal(spec.supportsLocalFilePreview, false);
});

test("shopify url settings use text-style input so relative theme paths remain valid", () => {
  const setting = createSetting({
    id: "button_link",
    type: "url",
    label: "Button Link",
  });

  const spec = getSettingControlSpec(setting);
  assert.equal(spec.kind, "url");
  assert.equal(spec.inputType, "text");
});
