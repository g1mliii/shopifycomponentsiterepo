import assert from "node:assert/strict";
import test from "node:test";

import { buildPreviewDocument } from "../src/app/components/[id]/sandbox/sandbox-helpers.ts";

test("buildPreviewDocument includes restrictive CSP meta for sandbox previews", () => {
  const document = buildPreviewDocument("<div>Preview</div>");

  assert.match(document, /http-equiv="Content-Security-Policy"/);
  assert.match(document, /default-src 'none'/);
  assert.match(document, /script-src 'unsafe-inline'/);
  assert.match(document, /connect-src 'none'/);
  assert.match(document, /frame-src 'none'/);
  assert.match(document, /worker-src 'none'/);
  assert.match(document, /child-src 'none'/);
  assert.match(document, /object-src 'none'/);
  assert.match(document, /base-uri 'none'/);
  assert.match(document, /form-action 'none'/);
});

test("buildPreviewDocument applies the page nonce to preview scripts", () => {
  const document = buildPreviewDocument("<script>window.test = true;</script>", "preview-nonce");

  assert.match(document, /script-src 'unsafe-inline' 'nonce-preview-nonce'/);
  assert.match(document, /<script nonce="preview-nonce">window\.test = true;<\/script>/);
  assert.match(document, /<script nonce="preview-nonce">[\s\S]*applyFitScale/);
});

test("buildPreviewDocument normalizes inline carousel and toggle handlers", () => {
  const document = buildPreviewDocument(
    [
      `<button onclick="document.getElementById('slider-1').scrollBy({left: 300, behavior: 'smooth'})">Next</button>`,
      `<button onclick="this.parentElement.classList.toggle('open')">Toggle</button>`,
    ].join(""),
    "preview-nonce",
  );

  assert.match(document, /data-pressplay-scroll-target="slider-1"/);
  assert.match(document, /data-pressplay-scroll-left="300"/);
  assert.match(document, /data-pressplay-toggle-parent-class="open"/);
  assert.doesNotMatch(document, /onclick=/);
  assert.match(document, /pressplay-preview-metrics/);
});
