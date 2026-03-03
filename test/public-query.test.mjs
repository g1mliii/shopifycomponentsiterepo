import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_COMPONENTS_PAGE_SIZE,
  PUBLIC_QUERY_MAX_LENGTH,
  parsePublicComponentsQuery,
} from "../src/lib/components/public-query-params.ts";

test("parsePublicComponentsQuery clamps page, query, and category", () => {
  const veryLongQuery = "x".repeat(PUBLIC_QUERY_MAX_LENGTH + 20);
  const parsed = parsePublicComponentsQuery(
    new URLSearchParams({
      page: "0",
      query: `   ${veryLongQuery}   `,
      category: "  HERO  ",
      limit: "999",
    }),
  );

  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, PUBLIC_COMPONENTS_PAGE_SIZE);
  assert.equal(parsed.query.length, PUBLIC_QUERY_MAX_LENGTH);
  assert.equal(parsed.category, "hero");
});

test("parsePublicComponentsQuery reads record search params", () => {
  const parsed = parsePublicComponentsQuery({
    page: "3",
    query: "  hero banner  ",
    category: ["  promotions  "],
  });

  assert.equal(parsed.page, 3);
  assert.equal(parsed.limit, PUBLIC_COMPONENTS_PAGE_SIZE);
  assert.equal(parsed.query, "hero banner");
  assert.equal(parsed.category, "promotions");
});

test("parsePublicComponentsQuery clears empty category", () => {
  const parsed = parsePublicComponentsQuery({
    page: "2",
    query: "",
    category: "   ",
  });

  assert.equal(parsed.page, 2);
  assert.equal(parsed.query, "");
  assert.equal(parsed.category, null);
});
