import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const { withExpoCompat } = createRequire(import.meta.url)("../packages/expo-compat/metro.cjs");
const temporary: string[] = [];
const libraries = ["clipboard", "document-picker"];
afterEach(() => { temporary.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

function fixture(dependencies: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-expo-compat-"));
  temporary.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "example", dependencies }));
  const upstream = vi.fn(() => ({ type: "sourceFile", filePath: "upstream" }));
  const context = { originModulePath: path.join(root, "App.tsx"), resolveRequest: upstream };
  return { root, upstream, context, resolve: withExpoCompat({ projectRoot: root }).resolver?.resolveRequest ?? upstream };
}

test.each(libraries)("redirects expo-%s on macOS only when the app declares it", name => {
  const { resolve, context, upstream } = fixture({ [`expo-${name}`]: "55.0.0" });
  expect(resolve(context, `expo-${name}`, "macos")).toEqual({ type: "sourceFile", filePath: path.resolve(`packages/expo-compat/src/${name}.ts`) });
  expect(upstream).not.toHaveBeenCalled();
  for (const platform of ["ios", "android", "web", "windows"]) {
    expect(resolve(context, `expo-${name}`, platform).filePath).toBe("upstream");
  }
  expect(resolve(context, `expo-${name}/build/index`, "macos").filePath).toBe("upstream");
  const absent = fixture({});
  expect(absent.resolve(absent.context, `expo-${name}`, "macos").filePath).toBe("upstream");
});

for (const [library, backend] of [["clipboard", "clipboard"], ["document-picker", "file-dialog"]]) {
  test.each([`packages/${backend}`, `node_modules/@legendapp/spark-${backend}`, `vendor/node_modules/@legendapp/spark-${backend}`])("leaves Spark's adapters at %s on the real library", directory => {
    const { root, resolve, context } = fixture({ [`expo-${library}`]: "55.0.17" });
    const location = path.join(root, directory);
    mkdirSync(path.join(location, "src"), { recursive: true });
    writeFileSync(path.join(location, "package.json"), JSON.stringify({ name: `@legendapp/spark-${backend}` }));
    expect(resolve({ ...context, originModulePath: path.join(location, "src/expo.ts") }, `expo-${library}`, "macos").filePath).toBe("upstream");
  });
}

test.each(libraries)("preserves the application's resolver and opts in through optional expo-%s", name => {
  const { root, context } = fixture({});
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ optionalDependencies: { [`expo-${name}`]: "55.0.17" } }));
  const custom = vi.fn(() => ({ type: "empty" }));
  const config = withExpoCompat({ projectRoot: root, resolver: { resolveRequest: custom } });
  expect(config.resolver.resolveRequest(context, `expo-${name}`, "macos").type).toBe("sourceFile");
  expect(config.resolver.resolveRequest(context, "other", "macos")).toEqual({ type: "empty" });
  expect(custom).toHaveBeenCalledWith(context, "other", "macos");
});
