import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

test("README creator commands consistently use the prerelease channel", () => {
  const commands = [...readme.matchAll(/\b(?:npm create|bun create|pnpm create|yarn create|npx) (@legendapp\/(?:create-)?spark(?:@[^\s`]+)?)/g)].map(match => match[1]);
  expect(commands).toContain("@legendapp/spark@next");
  expect(commands).toContain("@legendapp/create-spark@next");
  for (const creator of commands) expect(creator).toMatch(/^@legendapp\/(?:create-)?spark@next$/);
});

test("README distinguishes published Runner downloads from local source builds", () => {
  const text = readme.replace(/\s+/g, " ");
  expect(text).toMatch(/published CLI[^.]*downloads[^.]*Spark Runner[^.]*GitHub prerelease/);
  expect(text).toMatch(/source checkout needs a registered local Spark Runner/);
  expect(text).toMatch(/hosted Runner downloads use release metadata embedded in the published CLI/);
  expect(text).not.toMatch(/no hosted (?:Runner )?download service/i);
});
