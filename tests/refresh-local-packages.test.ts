import { expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("../packages/cli/src/commands.ts", () => ({ run: vi.fn(async () => "") }));
vi.mock("../packages/cli/src/executable.ts", () => ({ which: vi.fn((command: string) => command) }));
import { run } from "../packages/cli/src/commands.ts";
import { refreshLocalPackages } from "../packages/cli/src/create.ts";

for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
  test(`${manager} refresh upgrades cached desktop tooling and preserves custom app source`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "spark-refresh-"));
    const manifest = path.join(root, "archives.json");
    const custom = "// App-owned configuration\n";
    try {
      writeFileSync(manifest, JSON.stringify({ "@legendapp/spark": "sdk.tgz" }));
      writeFileSync(path.join(root, "package.json"), JSON.stringify({
        dependencies: { "@legendapp/spark": "0.0.1-next.2", "expo-desktop": "1.0.0-beta.6", "expo-desktop-template-bare-minimum": "54.81.1-beta.6", "react-native-macos": "0.81.7" },
      }));
      for (const file of ["metro.config.js", "index.ts", "desktop.config.json"]) writeFileSync(path.join(root, file), custom);
      await refreshLocalPackages(root, manifest, manager);
      expect(run).toHaveBeenLastCalledWith(root, [manager, "install"]);
      const first = readFileSync(path.join(root, "package.json"), "utf8");
      const pkg = JSON.parse(first);
      const pins = manager === "yarn" ? pkg.resolutions : manager === "pnpm" ? pkg.pnpm.overrides : pkg.overrides;
      expect(pkg.dependencies["expo-desktop"]).toBe("1.0.0");
      expect(pkg.dependencies["expo-desktop-template-bare-minimum"]).toBe("54.81.1");
      expect(pins["expo-desktop-config-plugins"]).toBe("1.2.0");
      expect(pins["react-native-macos"]).toBe("0.81.7");
      expect(pkg.dependencies["@legendapp/spark"]).toBe(pins["@legendapp/spark"]);
      await refreshLocalPackages(root, manifest, manager);
      expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(first);
      for (const file of ["metro.config.js", "index.ts", "desktop.config.json"]) expect(readFileSync(path.join(root, file), "utf8")).toBe(custom);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("pnpm refresh preserves the workspace's newer explicit web pins before install", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-refresh-web-"));
  try {
    const manifest = path.join(root, "archives.json");
    writeFileSync(manifest, JSON.stringify({ "@legendapp/spark": "sdk.tgz" }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ pnpm: { overrides: { dompurify: "3.4.17" } } }));
    const yaml = "# app policy\noverrides:\n  dompurify: 3.4.19\n";
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), yaml);
    await refreshLocalPackages(root, manifest, "pnpm");
    expect(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")).toContain("dompurify: 3.4.19");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("existing install paths repair dependencies introduced by the first install", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-install-web-"));
  try {
    const { installWithEnrichedHtmlPins, enrichedHtmlPins } = await import("../packages/cli/src/enriched-html-pins.ts");
    const { writeJson } = await import("../packages/cli/src/json.ts");
    writeJson(path.join(root, "package.json"), { dependencies: { react: "19.1.4" } });
    const dompurify = path.join(root, "node_modules/dompurify/package.json");
    vi.mocked(run).mockImplementationOnce(async () => {
      writeJson(path.join(root, "node_modules/react/package.json"), { name: "react", version: "19.1.4" });
      writeJson(path.join(root, "node_modules/react-native-enriched-html/package.json"), { name: "react-native-enriched-html", version: "1.1.1", dependencies: { dompurify: "3.4.11" } });
      writeJson(dompurify, { name: "dompurify", version: "3.4.11" });
      return "";
    }).mockImplementationOnce(async () => {
      expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).overrides).toMatchObject(enrichedHtmlPins);
      writeJson(dompurify, { name: "dompurify", version: enrichedHtmlPins.dompurify });
      return "";
    });
    const calls = vi.mocked(run).mock.calls.length;
    await installWithEnrichedHtmlPins(root, "npm");
    expect(vi.mocked(run).mock.calls.length - calls).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pnpm refresh preserves newer qualified web overrides in YAML", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-refresh-qualified-web-"));
  try {
    const manifest = path.join(root, "archives.json");
    writeFileSync(manifest, JSON.stringify({ "@legendapp/spark": "sdk.tgz" }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ pnpm: { overrides: { "react-native-enriched-html>dompurify": "3.4.17", "@tiptap/core@^3.27.1": "3.32.0" } } }));
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "overrides:\n  'react-native-enriched-html>dompurify': 3.4.19\n  '@tiptap/core@^3.27.1': 3.33.0\n");
    await refreshLocalPackages(root, manifest, "pnpm");
    const yaml = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).toContain("3.4.19");
    expect(yaml).toContain("3.33.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
