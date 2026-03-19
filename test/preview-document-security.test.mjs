import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFullPreviewDocument,
  buildPreviewDocument,
  normalizePreviewNonce,
} from "../src/app/components/[id]/sandbox/sandbox-helpers.ts";

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
  assert.match(document, /<script nonce="preview-nonce">[\s\S]*applyFitScale/);
  assert.match(document, /var previewInlineScripts = \["window\.test = true;"\]/);
  assert.match(document, /script\.setAttribute\("nonce", "preview-nonce"\)/);
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

test("buildPreviewDocument exposes a parent-driven preview state bridge for iframe scrolling", () => {
  const document = buildPreviewDocument("<div style=\"height: 320vh\">Preview</div>", "preview-nonce");

  assert.match(document, /pressplay-preview-set-state/);
  assert.match(document, /pressplay-preview-scroll-delta/);
  assert.match(document, /pressplay-preview-request-metrics/);
  assert.match(document, /window\.addEventListener\("message"/);
  assert.match(document, /window\.scrollTo\(\{ top: targetScrollTop, behavior: "auto" \}\)/);
  assert.match(document, /window\.scrollTo\(\{ top: nextScrollTop, behavior: "auto" \}\)/);
  assert.match(document, /lastReportedMetricsKey = ""/);
  assert.match(document, /viewportLockedLayout: lastViewportLockedMetrics/);
  assert.match(document, /window\.__pressplayPreview = \{/);
  assert.match(document, /maxScrollTop/);
  assert.match(document, /viewportHeight/);
});

test("buildFullPreviewDocument renders a standalone document without the iframe auto-fit shell", () => {
  const document = buildFullPreviewDocument(
    "<section><button onclick=\"document.getElementById('slider-1').scrollBy({left: 300, behavior: 'smooth'})\">Next</button></section>",
    "preview-nonce",
  );

  assert.match(document, /<body>\s*<section>/);
  assert.doesNotMatch(document, /pressplay-preview-root/);
  assert.doesNotMatch(document, /applyFitScale/);
  assert.match(document, /data-pressplay-scroll-target=\"slider-1\"/);
  assert.match(document, /document\.addEventListener\(\"click\"/);
  assert.match(document, /margin:\s*0/);
  assert.match(document, /padding:\s*0/);
});

test("buildFullPreviewDocument replays extracted inline scripts through nonce-bearing bootstrap", () => {
  const document = buildFullPreviewDocument("<div>Preview</div><script>window.popupReady = true;</script>", "preview-nonce");

  assert.doesNotMatch(document, /<script nonce="preview-nonce">window\.popupReady = true;<\/script>/);
  assert.match(document, /var previewInlineScripts = \["window\.popupReady = true;"\]/);
  assert.match(document, /script\.setAttribute\("nonce", "preview-nonce"\)/);
});

test("normalizePreviewNonce trims usable nonce values and rejects blank input", () => {
  assert.equal(normalizePreviewNonce(" preview-nonce "), "preview-nonce");
  assert.equal(normalizePreviewNonce(""), null);
  assert.equal(normalizePreviewNonce("   "), null);
  assert.equal(normalizePreviewNonce(null), null);
  assert.equal(normalizePreviewNonce(undefined), null);
});
