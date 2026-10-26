import { parse } from "yaml";
import { writePackageConfig } from "../packages/cli/src/package-manager-config.ts";
import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyOverrides, managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-manager-"));
  const bin = path.join(root, "bin"); mkdirSync(bin);
  for (const name of ["npm", "pnpm", "yarn", "bun"]) writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { root, env: { PATH: bin }, close: () => rmSync(root, { recursive: true, force: true }) };
}
test("package manager selection respects explicit choice, project declaration, lockfile, then caller", () => {
  const f = fixture();
  try {
    expect(packageManager(f.root, undefined, f.env)).toBe("npm");
    expect(packageManager(f.root, undefined, { ...f.env, npm_config_user_agent: "yarn/4.0.0" })).toBe("yarn");
    writeFileSync(path.join(f.root, "pnpm-lock.yaml"), "");
    expect(packageManager(f.root, undefined, { ...f.env, npm_config_user_agent: "npm/11" })).toBe("pnpm");
    writeFileSync(path.join(f.root, "package-lock.json"), "{}");
    expect(() => packageManager(f.root, undefined, f.env)).toThrow("existing lockfiles");
    writeFileSync(path.join(f.root, "package.json"), JSON.stringify({ packageManager: "yarn@4.0.0" }));
    expect(packageManager(f.root, undefined, f.env)).toBe("yarn");
    expect(packageManager(f.root, "npm", f.env)).toBe("npm");
    expect(() => packageManager(f.root, "unknown", f.env)).toThrow("Unsupported");
    expect(() => packageManager(f.root, "pnpm", { PATH: "" })).toThrow("not installed");
  } finally { f.close(); }
});
test.each(["bun.lock", "bun.lockb"])("%s selects Bun without overriding an explicit consumer manager", lock => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.root, lock), "");
    expect(packageManager(f.root, undefined, { ...f.env, npm_config_user_agent: "npm/12" })).toBe("bun");
    writeFileSync(path.join(f.root, "package-lock.json"), "{}");
    expect(() => packageManager(f.root, undefined, f.env)).toThrow("existing lockfiles");
    writeFileSync(path.join(f.root, "package.json"), JSON.stringify({ packageManager: "bun@1.3.14" }));
    expect(packageManager(f.root, undefined, f.env)).toBe("bun");
    expect(packageManager(f.root, "npm", f.env)).toBe("npm");
  } finally { f.close(); }
});
test("override conversion keeps pins and writes each manager's supported field", () => {
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const pkg: any = { overrides: { react: "19.1.4" }, dependencies: { "@legendapp/spark": "file:/tmp/frame.tgz" } };
    applyOverrides(pkg, { "@legendapp/spark": "file:/tmp/frame.tgz" }, manager);
    const pins = manager === "pnpm" ? pkg.pnpm.overrides : manager === "yarn" ? pkg.resolutions : pkg.overrides;
    expect(pins).toEqual({ react: "19.1.4", "@legendapp/spark": "file:/tmp/frame.tgz" });
    expect(pkg.dependencies["@legendapp/spark"]).toBe("file:/tmp/frame.tgz");
  }
});
test("pnpm archive overrides provide the native peer at the installation root", () => {
  const archive = "file:./spark-packages/nitro.tgz";
  for (const manager of ["npm", "yarn", "bun", "pnpm"] as const) {
    const pkg: any = { dependencies: { "@legendapp/spark": "0.0.1-next.5" } };
    applyOverrides(pkg, { "react-native-nitro-modules": archive }, manager);
    expect(pkg.dependencies["react-native-nitro-modules"]).toBe(manager === "pnpm" ? archive : undefined);
    if (manager === "pnpm") {
      expect(pkg.pnpm.overrides["react-native-nitro-modules"]).toBe(archive);
      applyOverrides(pkg, { "react-native-nitro-modules": "file:./spark-packages/new-nitro.tgz" }, manager);
      expect(pkg.dependencies["react-native-nitro-modules"]).toBe("file:./spark-packages/new-nitro.tgz");
    }
  }
});

test("all package manager overrides preserve portable release archive references", () => {
  const source = "file:./spark-packages/react-native-webview-" + "a".repeat(64) + ".tgz";
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const pkg: any = { dependencies: { "react-native-webview": source } };
    applyOverrides(pkg, { "react-native-webview": source }, manager);
    const field = manager === "pnpm" ? pkg.pnpm.overrides : manager === "yarn" ? pkg.resolutions : pkg.overrides;
    expect(pkg.dependencies["react-native-webview"]).toBe(source);
    expect(field["react-native-webview"]).toBe(source);
    expect(source).toMatch(/^file:\.\//);
  }
});
test("manager invocations reuse the invoking JavaScript executable", () => {
  expect(managerCommand("pnpm", ["install"], { npm_config_user_agent: "pnpm/10", npm_execpath: "/space here/pnpm.cjs" })).toEqual([process.execPath, "/space here/pnpm.cjs", "install"]);
  expect(managerCommand("npm", ["install"], { npm_config_user_agent: "pnpm/10", npm_execpath: "/pnpm.cjs" })).toEqual(["npm", "install"]);
});

test("pnpm configuration persists pins and build permissions while retaining user YAML", () => {
  const f = fixture();
  try {
    const file = path.join(f.root, "pnpm-workspace.yaml");
    writeFileSync(file, "# Keep team configuration\npackages:\n  - .\noverrides:\n  custom: 1.0.0\nallowBuilds:\n  fsevents: false\n");
    const pkg = { dependencies: { "@legendapp/spark": "file:./spark.tgz" }, pnpm: { overrides: { react: "19.1.4" }, onlyBuiltDependencies: ["fsevents", "@legendapp/spark"] } };
    writePackageConfig(f.root, pkg, "pnpm");
    expect(parse(readFileSync(file, "utf8"))).toEqual({ packages: ["."], nodeLinker: "hoisted", overrides: { custom: "1.0.0", react: "19.1.4" }, allowBuilds: { fsevents: false, "@legendapp/spark": true, "@legendapp/spark@file:spark.tgz": true } });
    expect(readFileSync(file, "utf8")).toContain("# Keep team configuration");
    expect(pkg.pnpm.onlyBuiltDependencies).toContain("@legendapp/spark@file:spark.tgz");
    expect(pkg.pnpm.onlyBuiltDependencies).not.toContain("fsevents");
    expect(JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")).pnpm).not.toHaveProperty("overrides");
    applyOverrides(pkg, { react: "19.1.5" }, "pnpm");
    writePackageConfig(f.root, pkg, "pnpm");
    expect(parse(readFileSync(file, "utf8")).overrides).toEqual({ custom: "1.0.0", react: "19.1.5" });
    const yaml = readFileSync(file, "utf8");
    writePackageConfig(f.root, pkg, "pnpm");
    expect(readFileSync(file, "utf8")).toBe(yaml);
  } finally { f.close(); }
});
