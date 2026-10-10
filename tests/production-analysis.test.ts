import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, metroSourceFiles } from "../packages/cli/src/build.ts";
import { writeJson } from "../packages/cli/src/project.ts";

const metro = vi.hoisted(() => ({ run: vi.fn(), sources: [] as string[] }));
vi.mock("../packages/cli/src/commands.ts", () => ({ doctor: vi.fn(), binary: (_root: string, name: string) => name, run: metro.run }));
vi.mock("../packages/cli/src/native-patch-preflight.ts", () => ({ assertNativePatchPreflight: vi.fn() }));

let dir: string;
const write = (file: string, value = "") => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
const sdkPackage = (root: string, name: string) => {
  writeJson(path.join(root, "package.json"), { name, version: "1.0.0", codegenConfig: { name: name.replace(/\W/g, "") }, spark: { sdk: true } });
  write(path.join(root, "src/index.tsx"), "export {};");
};
const app = (root: string) => {
  writeJson(path.join(root, "package.json"), { main: "index.ts", dependencies: { "@legendapp/spark-ui": "1.0.0", "@legendapp/spark-tray": "1.0.0" } });
  write(path.join(root, "index.ts"), "import '@legendapp/spark-ui';");
  writeJson(path.join(root, "app.json"), { expo: { name: "Fixture", slug: "fixture", version: "1.0.0", platforms: ["macos"], extra: { spark: { projectId: "test.fixture" } } } });
  return root;
};

// Expo writes source map entries relative to Metro's server root: the
// workspace root for an in-repo app, the app itself for a published consumer.
const layouts = {
  installed() {
    const root = app(path.join(dir, "consumer"));
    for (const name of ["ui", "tray"]) sdkPackage(path.join(root, "node_modules/@legendapp", `spark-${name}`), `@legendapp/spark-${name}`);
    return { root, sources: ["__prelude__", "\0polyfill:environment-variables", "/index.ts", "/node_modules/@legendapp/spark-ui/src/index.tsx"] };
  },
  workspace() {
    writeJson(path.join(dir, "package.json"), { name: "workspace", private: true, workspaces: ["packages/*", "examples/*"] });
    for (const name of ["ui", "tray"]) {
      sdkPackage(path.join(dir, "packages", name), `@legendapp/spark-${name}`);
      mkdirSync(path.join(dir, "node_modules/@legendapp"), { recursive: true });
      symlinkSync(`../../packages/${name}`, path.join(dir, "node_modules/@legendapp", `spark-${name}`));
    }
    return { root: app(path.join(dir, "examples/app")), sources: ["__prelude__", "\0polyfill:environment-variables", "/examples/app/index.ts", "/packages/ui/src/index.tsx"] };
  },
};

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "spark-analysis-"));
  metro.run.mockReset();
  metro.run.mockImplementation(async (_root: string, argv: string[]) => {
    if (!argv.includes("export:embed")) throw new Error(`Unexpected command: ${argv.join(" ")}`);
    write(argv[argv.indexOf("--bundle-output") + 1]!, "bundle");
    write(argv[argv.indexOf("--sourcemap-output") + 1]!, JSON.stringify({ sources: metro.sources }));
    return "";
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test.each(Object.keys(layouts) as (keyof typeof layouts)[])("%s SDK packages reached by production code keep their native modules", async layout => {
  const { root, sources } = layouts[layout]();
  metro.sources = sources;
  const result = await analyze(root);
  expect(result.included.map(pkg => pkg.name)).toEqual(["@legendapp/spark-ui"]);
  expect(result.excluded.map(pkg => pkg.name)).toEqual(["@legendapp/spark-tray"]);
  expect(result.reasons).toEqual({ "@legendapp/spark-ui": "reachable production import" });
  expect(result.included[0]!.root).toBe(realpathSync(layout === "workspace" ? path.join(dir, "packages/ui") : path.join(root, "node_modules/@legendapp/spark-ui")));
});

test("source map entries resolve from the server root that contains the entry module", () => {
  const { root } = layouts.workspace();
  const workspace = realpathSync(dir);
  expect(metroSourceFiles(path.join(root, "index.ts"), ["/examples/app/index.ts", "/packages/ui/src/index.tsx", "\0polyfill:x"]))
    .toEqual([path.join(workspace, "examples/app/index.ts"), path.join(workspace, "packages/ui/src/index.tsx")]);
  // Absolute paths are relative to the filesystem root.
  const absolute = path.join(workspace, "examples/app/index.ts");
  expect(metroSourceFiles(path.join(root, "index.ts"), [absolute])).toEqual([absolute]);
  expect(() => metroSourceFiles(path.join(root, "index.ts"), ["/packages/ui/src/index.tsx"])).toThrow("does not contain");
});
