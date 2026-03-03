import test from "node:test";
import assert from "node:assert/strict";

import {
  getMediaKindFromThumbnailPath,
  isVideoThumbnailPath,
} from "../src/lib/components/media-kind.ts";

test("getMediaKindFromThumbnailPath identifies video extensions", () => {
  assert.equal(getMediaKindFromThumbnailPath("components/abc/thumb.mp4"), "video");
  assert.equal(getMediaKindFromThumbnailPath("components/abc/thumb.WEBM"), "video");
});

test("getMediaKindFromThumbnailPath defaults to image", () => {
  assert.equal(getMediaKindFromThumbnailPath("components/abc/thumb.png"), "image");
  assert.equal(getMediaKindFromThumbnailPath("components/abc/thumb"), "image");
  assert.equal(isVideoThumbnailPath("components/abc/thumb.png"), false);
});
