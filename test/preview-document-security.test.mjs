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
  assert.match(document, /navigate-to 'none'/);
  assert.match(document, /frame-ancestors 'none'/);
  assert.match(document, /form-action 'none'/);
});
