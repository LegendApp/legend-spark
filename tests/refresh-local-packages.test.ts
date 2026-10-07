import { expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("../packages/cli/src/commands.ts", () => ({ run: vi.fn(async () => "") }));
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
