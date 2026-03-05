import assert from "node:assert/strict";
import test from "node:test";

import { applyMediaOverrides } from "../src/app/components/[id]/sandbox/sandbox-helpers.ts";

function buildState() {
  return {
    sectionSettings: {
      hero_image: "",
      heading: "Heading",
    },
    blocks: [
      {
        id: "block_1",
        type: "card",
        settings: {
          image: "",
          title: "Card A",
        },
      },
      {
        id: "block_2",
        type: "card",
        settings: {
          image: "",
          title: "Card B",
        },
      },
    ],
  };
}

test("applyMediaOverrides returns original state for empty or invalid overrides", () => {
  const state = buildState();
  assert.equal(applyMediaOverrides(state, {}), state);
  assert.equal(applyMediaOverrides(state, { "unknown:path": "https://cdn.example.test/x.jpg" }), state);
});

test("applyMediaOverrides only clones section settings when section override is applied", () => {
  const state = buildState();
  const next = applyMediaOverrides(state, { "section:hero_image": "https://cdn.example.test/hero.jpg" });

  assert.notEqual(next, state);
  assert.notEqual(next.sectionSettings, state.sectionSettings);
  assert.equal(next.blocks, state.blocks);
  assert.equal(next.sectionSettings.hero_image, "https://cdn.example.test/hero.jpg");
});

test("applyMediaOverrides only clones affected block when block override is applied", () => {
  const state = buildState();
  const next = applyMediaOverrides(state, { "block:block_1:image": "https://cdn.example.test/card-a.jpg" });

  assert.notEqual(next, state);
  assert.equal(next.sectionSettings, state.sectionSettings);
  assert.notEqual(next.blocks, state.blocks);
  assert.notEqual(next.blocks[0], state.blocks[0]);
  assert.equal(next.blocks[1], state.blocks[1]);
  assert.equal(next.blocks[0].settings.image, "https://cdn.example.test/card-a.jpg");
});

test("applyMediaOverrides keeps identity when override value is unchanged", () => {
  const state = buildState();
  const next = applyMediaOverrides(state, { "section:heading": "Heading" });
  assert.equal(next, state);
});
