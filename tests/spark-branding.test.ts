import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync, globSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
test("public spark package exposes the CLI and component entry points", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "packages/desktop/package.json"), "utf8"));
  expect(pkg.name).toBe("@legendapp/spark");
  expect(pkg.bin.spark).toBe("bin/spark.cjs");
  for (const entry of ["./ui", "./ui/uniwind", "./audio", "./auth-session", "./files", "./windows"]) {
    expect(existsSync(require.resolve(`@legendapp/spark/${entry.slice(2)}`))).toBe(true);
  }
  const command = spawnSync(process.execPath, [path.join(root, "packages/desktop/bin/spark.cjs"), "--help"], { cwd: root });
  expect(command.status).toBe(0);
  expect(command.stdout.toString()).toContain("Legend Spark");
  expect(command.stdout.toString()).toContain("spark create MyApp");
});
test("framework packages and generated commands use spark names", () => {
  for (const directory of readdirSync(path.join(root, "packages"))) {
    const pkg = JSON.parse(readFileSync(path.join(root, "packages", directory, "package.json"), "utf8"));
    expect(pkg.name === "@legendapp/create-spark" || pkg.name === "@legendapp/spark" || pkg.name.startsWith("@legendapp/spark-")).toBe(true);
    expect(pkg.legend).toBeUndefined();
    expect(pkg.frame).toBeUndefined();
    for (const name of Object.keys(pkg.dependencies ?? {})) expect(name.startsWith("@legend-apps/") || name.startsWith("@legendapp/frame")).toBe(false);
  }
  for (const template of ["blank-typescript", "windows", "universal"]) {
    const pkg = JSON.parse(readFileSync(path.join(root, "packages/cli/templates", template, "package.json"), "utf8"));
    expect(pkg.scripts.dev).toBe("spark dev");
    expect(pkg.scripts.postinstall).toBe("node node_modules/@legendapp/spark/init-template.cjs");
  }
});

test("renamed Windows projects reference existing local source and resource files", () => {
  let projects = 0;
  for (const base of ["packages", "fixtures", "patches"]) {
    for (const file of globSync("**/*.vcxproj", { cwd: path.join(root, base) })) {
      if (file.includes("node_modules/")) continue;
      projects++;
      const project = path.join(root, base, file);
      const source = readFileSync(project, "utf8");
      for (const match of source.matchAll(/<(?:ClCompile|ClInclude|ResourceCompile|Midl) Include="([^"]+)"/g)) {
        const relative = match[1]!;
        if (relative.includes("$") || relative.includes("*")) continue;
        expect(existsSync(path.resolve(path.dirname(project), relative.replaceAll("\\", "/")))).toBe(true);
      }
    }
  }
  expect(projects).toBeGreaterThanOrEqual(18);
});
