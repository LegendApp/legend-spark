import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

test("README creator commands consistently use the prerelease channel", () => {
  const commands = [...readme.matchAll(/\b(?:npm create|bun create|pnpm create|yarn create|npx|bunx) (@legendapp\/(?:create-)?spark(?:@[^\s`]+)?)/g)].map(match => match[1]);
  expect(commands).toContain("@legendapp/spark@next");
  expect(commands).toContain("@legendapp/create-spark@next");
  for (const creator of commands) expect(creator).toMatch(/^@legendapp\/(?:create-)?spark@next$/);
});

test("README and kitchen sink guide distinguish published Runner downloads from local source builds", () => {
  expect(readme.replace(/\s+/g, " ")).toMatch(/published CLI[^.]*downloads[^.]*Spark Runner[^.]*GitHub prerelease/);
  for (const file of ["README.md", "examples/kitchen-sink/README.md"]) {
    const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
    expect(text, file).toMatch(/source (?:checkout|example) needs a registered local (?:Spark )?Runner/);
    expect(text, file).toMatch(/hosted (?:Runner )?downloads (?:use|require) release metadata embedded in the published CLI/);
    expect(text, file).not.toMatch(/no hosted (?:prebuilt )?(?:Runner )?download service/i);
  }
});
