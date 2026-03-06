import assert from "node:assert/strict";
import test from "node:test";

import { parseUploadDraftSnapshot } from "../src/lib/liquid/upload-draft.ts";

test("parseUploadDraftSnapshot returns sanitized draft data for valid payloads", () => {
  const draft = parseUploadDraftSnapshot({
    version: 1,
    title: "Benefit Showcase",
    category: "feature",
    localLiquidSource: "{% schema %}{\"name\":\"Benefit Showcase\"}{% endschema %}",
    localLiquidFileName: "benefit-showcase.liquid",
    editorState: {
      sectionSettings: {
        heading: "Why Choose Us",
      },
      blocks: [
        {
          id: "block_benefit_card_1",
          type: "benefit_card",
          settings: {
            headline: "Precision Crafted",
          },
        },
      ],
    },
    pendingBlockType: "benefit_card",
    splitPercent: 44,
  });

  assert.ok(draft);
  assert.equal(draft?.title, "Benefit Showcase");
  assert.equal(draft?.editorState?.blocks.length, 1);
  assert.equal(draft?.splitPercent, 44);
});

test("parseUploadDraftSnapshot rejects unsupported draft versions", () => {
  const draft = parseUploadDraftSnapshot({
    version: 2,
    title: "Benefit Showcase",
    category: "feature",
    localLiquidSource: "",
    localLiquidFileName: null,
    editorState: null,
    pendingBlockType: "",
    splitPercent: 44,
  });

  assert.equal(draft, null);
});

test("parseUploadDraftSnapshot rejects invalid editor state payloads", () => {
  const draft = parseUploadDraftSnapshot({
    version: 1,
    title: "Benefit Showcase",
    category: "feature",
    localLiquidSource: "",
    localLiquidFileName: null,
    editorState: {
      sectionSettings: {},
      blocks: [
        {
          id: "broken",
          type: "benefit_card",
          settings: "invalid",
        },
      ],
    },
    pendingBlockType: "",
    splitPercent: 44,
  });

  assert.equal(draft, null);
});
