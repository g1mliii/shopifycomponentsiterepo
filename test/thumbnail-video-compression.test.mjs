import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompressedThumbnailFileName,
  galleryThumbnailVideoCompressionPreset,
  getThumbnailCompressionPlaybackLimitMs,
  getVideoContainPlacementRect,
  isVideoThumbnailFile,
  normalizeVideoMimeType,
  shouldCompressThumbnailVideo,
} from "../src/lib/media/thumbnail-video-compression.ts";

test("isVideoThumbnailFile detects supported video thumbnails by mime or extension", () => {
  assert.equal(
    isVideoThumbnailFile({ name: "preview.mp4", type: "video/mp4" }),
    true,
  );
  assert.equal(
    isVideoThumbnailFile({ name: "preview.webm", type: "" }),
    true,
  );
  assert.equal(
    isVideoThumbnailFile({ name: "preview.png", type: "image/png" }),
    false,
  );
});

test("shouldCompressThumbnailVideo skips already small gallery-sized videos", () => {
  assert.equal(
    shouldCompressThumbnailVideo({
      sourceWidth: galleryThumbnailVideoCompressionPreset.targetWidth,
      sourceHeight: galleryThumbnailVideoCompressionPreset.targetHeight,
      fileSize: galleryThumbnailVideoCompressionPreset.minimumInputBytes,
    }),
    false,
  );
});

test("shouldCompressThumbnailVideo compresses oversized videos by dimensions or size", () => {
  assert.equal(
    shouldCompressThumbnailVideo({
      sourceWidth: 1920,
      sourceHeight: 1080,
      fileSize: 500_000,
    }),
    true,
  );
  assert.equal(
    shouldCompressThumbnailVideo({
      sourceWidth: 480,
      sourceHeight: 360,
      fileSize: galleryThumbnailVideoCompressionPreset.minimumInputBytes + 1,
    }),
    true,
  );
});

test("getVideoContainPlacementRect letterboxes wide videos inside the 4:3 target", () => {
  const placement = getVideoContainPlacementRect(1920, 1080, 480, 360);

  assert.equal(Math.round(placement.x), 0);
  assert.equal(Math.round(placement.width), 480);
  assert.equal(Math.round(placement.height), 270);
  assert.equal(Math.round(placement.y), 45);
});

test("getThumbnailCompressionPlaybackLimitMs caps long source playback aggressively", () => {
  assert.equal(
    getThumbnailCompressionPlaybackLimitMs(30),
    galleryThumbnailVideoCompressionPreset.maximumDurationMs,
  );
  assert.equal(
    getThumbnailCompressionPlaybackLimitMs(2.25),
    2_500,
  );
});

test("buildCompressedThumbnailFileName appends gallery suffix and output extension", () => {
  assert.equal(
    buildCompressedThumbnailFileName("hero-preview.mp4", "video/webm"),
    "hero-preview-card.webm",
  );
  assert.equal(
    buildCompressedThumbnailFileName("hero-preview", "video/mp4"),
    "hero-preview-card.mp4",
  );
});

test("normalizeVideoMimeType strips codec suffixes to validator-safe base types", () => {
  assert.equal(
    normalizeVideoMimeType("video/webm;codecs=vp9"),
    "video/webm",
  );
  assert.equal(
    normalizeVideoMimeType("video/mp4;codecs=avc1.42E01E"),
    "video/mp4",
  );
});
