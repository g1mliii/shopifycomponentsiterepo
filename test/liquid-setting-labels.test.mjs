import assert from "node:assert/strict";
import test from "node:test";

import { getPlainLanguageSettingLabel, getSettingJargonHint } from "../src/lib/liquid/setting-labels.ts";

test("getPlainLanguageSettingLabel maps CTA wording to button wording", () => {
  assert.equal(getPlainLanguageSettingLabel("CTA Label"), "Button Text");
  assert.equal(getPlainLanguageSettingLabel("CTA URL"), "Button Link");
  assert.equal(getPlainLanguageSettingLabel("Hero CTA Link"), "Hero Button Link");
});

test("getPlainLanguageSettingLabel maps common theme jargon terms", () => {
  assert.equal(getPlainLanguageSettingLabel("Eyebrow"), "Small Heading");
  assert.equal(getPlainLanguageSettingLabel("Kicker"), "Small Heading");
});

test("getSettingJargonHint explains CTA and heading jargon", () => {
  assert.equal(getSettingJargonHint("CTA Label"), 'CTA means "Call to action" (usually a button).');
  assert.equal(
    getSettingJargonHint("Eyebrow"),
    "This is short intro text displayed above a heading in many themes.",
  );
});

test("getSettingJargonHint returns null for plain terms", () => {
  assert.equal(getSettingJargonHint("Heading"), null);
});
