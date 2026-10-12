import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { TEST_CLIP_BASE64 } from "../examples/kitchen-sink/screens/media/test-clip.ts";

test("the Kitchen Sink's bundled video clip is the silent test fixture", () => {
  expect(Buffer.from(TEST_CLIP_BASE64, "base64").equals(readFileSync("tests/fixtures/media/test-clip.mp4"))).toBe(true);
});
