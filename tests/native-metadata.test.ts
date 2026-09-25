import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { restoreNativeMetadata } from "../packages/cli/src/native-metadata.ts";

test("template renaming cannot change configured identity or nested document metadata", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-metadata-"));
  try {
    mkdirSync(path.join(root, ".spark"));
    mkdirSync(path.join(root, "macos/LegendHelloWorld"), { recursive: true });
    const file = path.join(root, "macos/LegendHelloWorld/Info.plist");
    writeFileSync(file, JSON.stringify({ SparkProjectIdentifier: "so.legend.legendhelloworld", CFBundleExecutable: "$(EXECUTABLE_NAME)", CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ["legendhelloworld"] }] }));
    await restoreNativeMetadata(root, { extra: { spark: { projectId: "so.legend.helloworld" } }, macos: { infoPlist: { CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ["helloworld"] }] } } }, async (_root, argv) => argv.includes("json") ? readFileSync(argv.at(-1)!, "utf8") : "");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ SparkProjectIdentifier: "so.legend.helloworld", CFBundleExecutable: "$(EXECUTABLE_NAME)", CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ["helloworld"] }] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
