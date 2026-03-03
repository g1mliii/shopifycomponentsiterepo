import assert from "node:assert/strict";
import test from "node:test";

import { LatestPreviewScheduler } from "../src/lib/liquid/preview-scheduler.ts";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("LatestPreviewScheduler keeps only the latest successful result", async () => {
  const successes = [];
  const errors = [];

  const scheduler = new LatestPreviewScheduler({
    run: async (input, signal) => {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, 20);
        const abortHandler = () => {
          clearTimeout(timeoutId);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };

        if (signal.aborted) {
          abortHandler();
          return;
        }

        signal.addEventListener("abort", abortHandler, { once: true });
      });

      return input;
    },
    onSuccess: (output) => {
      successes.push(output);
    },
    onError: (error) => {
      errors.push(error);
    },
    requestFrame: (callback) => {
      const timeoutId = setTimeout(callback, 0);
      return () => clearTimeout(timeoutId);
    },
  });

  scheduler.enqueue("first");
  await delay(2);
  scheduler.enqueue("second");
  await delay(2);
  scheduler.enqueue("third");

  await delay(80);
  scheduler.dispose();

  assert.deepEqual(successes, ["third"]);
  assert.equal(errors.length, 0);
});

test("LatestPreviewScheduler supports falsy inputs without dropping them", async () => {
  const successes = [];

  const scheduler = new LatestPreviewScheduler({
    run: async (input) => input,
    onSuccess: (output) => {
      successes.push(output);
    },
    onError: () => {},
    requestFrame: (callback) => {
      const timeoutId = setTimeout(callback, 0);
      return () => clearTimeout(timeoutId);
    },
  });

  scheduler.enqueue(0);
  await delay(20);
  scheduler.dispose();

  assert.deepEqual(successes, [0]);
});

test("LatestPreviewScheduler dispose cancels scheduled work", async () => {
  let runCount = 0;
  const successes = [];

  const scheduler = new LatestPreviewScheduler({
    run: async (input) => {
      runCount += 1;
      return input;
    },
    onSuccess: (output) => {
      successes.push(output);
    },
    onError: () => {},
    requestFrame: (callback) => {
      const timeoutId = setTimeout(callback, 50);
      return () => clearTimeout(timeoutId);
    },
  });

  scheduler.enqueue("pending");
  scheduler.dispose();
  await delay(80);

  assert.equal(runCount, 0);
  assert.equal(successes.length, 0);
});
