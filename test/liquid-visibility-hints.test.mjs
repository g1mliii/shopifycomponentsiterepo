import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingLookup, getConditionalVisibilityHints } from "../src/lib/liquid/visibility-hints.ts";

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

test("returns hint when label has content and paired URL is empty", () => {
  const labelSetting = createSetting({
    id: "cta_label",
    label: "CTA Label",
  });
  const urlSetting = createSetting({
    id: "cta_url",
    type: "url",
    label: "CTA URL",
  });

  const lookup = buildSettingLookup([labelSetting, urlSetting]);
  const hints = getConditionalVisibilityHints(
    labelSetting,
    "Open now",
    {
      cta_label: "Open now",
      cta_url: "",
    },
    lookup,
  );

  assert.deepEqual(hints, ['Preview may hide this label until "Button Link" is set.']);
});

test("does not return hint when paired URL is present", () => {
  const labelSetting = createSetting({
    id: "hero_link_label",
    label: "Hero CTA Label",
  });
  const urlSetting = createSetting({
    id: "hero_link",
    type: "url",
    label: "Hero CTA Link",
  });

  const lookup = buildSettingLookup([labelSetting, urlSetting]);
  const hints = getConditionalVisibilityHints(
    labelSetting,
    "Learn more",
    {
      hero_link_label: "Learn more",
      hero_link: "https://example.test",
    },
    lookup,
  );

  assert.deepEqual(hints, []);
});

test("does not return hint for non-label settings", () => {
  const textSetting = createSetting({
    id: "headline",
    label: "Headline",
  });
  const lookup = buildSettingLookup([textSetting]);
  const hints = getConditionalVisibilityHints(
    textSetting,
    "Welcome",
    {
      headline: "Welcome",
    },
    lookup,
  );

  assert.deepEqual(hints, []);
});

test("returns hint when alt text has content and paired media is empty", () => {
  const altSetting = createSetting({
    id: "hero_image_alt",
    label: "Hero Image Alt Text",
  });
  const mediaSetting = createSetting({
    id: "hero_image",
    type: "image_picker",
    label: "Hero Image",
  });

  const lookup = buildSettingLookup([altSetting, mediaSetting]);
  const hints = getConditionalVisibilityHints(
    altSetting,
    "Decorative hero visual",
    {
      hero_image_alt: "Decorative hero visual",
      hero_image: "",
    },
    lookup,
  );

  assert.deepEqual(hints, ['Preview may hide this alt text until "Hero Image" has a value.']);
});

test("returns hint when related visibility toggle is disabled", () => {
  const titleSetting = createSetting({
    id: "announcement_title",
    label: "Announcement Title",
  });
  const showToggle = createSetting({
    id: "show_announcement",
    type: "checkbox",
    label: "Show Announcement",
  });

  const lookup = buildSettingLookup([titleSetting, showToggle]);
  const hints = getConditionalVisibilityHints(
    titleSetting,
    "Important update",
    {
      announcement_title: "Important update",
      show_announcement: false,
    },
    lookup,
  );

  assert.deepEqual(hints, ['Preview may hide this field while "Show Announcement" is disabled.']);
});
