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
