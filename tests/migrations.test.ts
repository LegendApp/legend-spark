import { afterEach, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { claudePointer, mergePointer, migrateProject, migrations, pointer, refreshPointers } from "../packages/cli/src/migrations.cjs";
import { ensureProjectVersion } from "../packages/cli/src/project-version.ts";

const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version;
const roots: string[] = [];
function app(installed = version) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-migration-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark": installed } }));
  mkdirSync(path.join(root, "node_modules/@legendapp/spark"), { recursive: true });
  writeFileSync(path.join(root, "node_modules/@legendapp/spark/package.json"), JSON.stringify({ name: "@legendapp/spark", version: installed, exports: { "./package.json": "./package.json" } }));
  writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ projectId: "migration-test", platforms: ["macos", "windows"] }));
  return root;
}
function stamp(root: string, value: string) {
  mkdirSync(path.join(root, ".spark"), { recursive: true });
  writeFileSync(path.join(root, ".spark/version"), value + "\n");
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("pointer merging preserves all user content and replaces only the marked section", () => {
  const source = "# Team instructions\nUse pnpm.\n";
  const merged = mergePointer(source);
  expect(merged.startsWith(source)).toBe(true);
  expect(merged).toContain(pointer);
  expect(mergePointer(merged)).toBe(merged);
  const customized = `Prefix\n<!-- spark:skill:start -->\nold pointer\n<!-- spark:skill:end -->\nSuffix`;
  expect(mergePointer(customized)).toBe(`Prefix\n${pointer}\nSuffix`);
});

test("malformed markers leave every pointer file untouched", () => {
  const root = app();
  writeFileSync(path.join(root, "AGENTS.md"), "User instructions");
  writeFileSync(path.join(root, "CLAUDE.md"), "<!-- spark:skill:start -->");
  expect(() => refreshPointers(root)).toThrow("run spark upgrade");
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe("User instructions");
  expect(existsSync(path.join(root, ".claude"))).toBe(false);
  for (const text of ["<!-- spark:skill:end -->", "<!-- spark:skill:end --><!-- spark:skill:start -->", pointer + pointer]) expect(() => mergePointer(text)).toThrow();
});

test("pointer refresh preserves a user Claude skill and does not rewrite unchanged files", () => {
  const root = app();
  const file = path.join(root, ".claude/skills/spark/SKILL.md");
  mkdirSync(path.dirname(file), { recursive: true });
  const user = "---\nname: my-spark\ndescription: Custom guidance.\n---\n\nKeep this.\n";
  writeFileSync(file, user);
  refreshPointers(root);
  const content = readFileSync(file, "utf8");
  const time = statSync(file).mtimeMs;
  expect(content.startsWith(user)).toBe(true);
  expect(content).toContain(pointer);
  refreshPointers(root);
  expect(readFileSync(file, "utf8")).toBe(content);
  expect(statSync(file).mtimeMs).toBe(time);
});

test("unrecorded and older apps migrate once with one shared version across platforms", () => {
  const root = app();
  ensureProjectVersion(root);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
  expect(readFileSync(path.join(root, ".claude/skills/spark/SKILL.md"), "utf8")).toBe(claudePointer);
  const time = statSync(path.join(root, ".spark/version")).mtimeMs;
  expect(migrateProject(root, version)).toEqual([]);
  expect(statSync(path.join(root, ".spark/version")).mtimeMs).toBe(time);
  expect(existsSync(path.join(root, ".spark/platforms"))).toBe(false);
  stamp(root, "0.0.1-next.3");
  expect(migrateProject(root, version)).toEqual(["0.0.1-next.4"]);
});

test("automatic migration stops before any writes when a pending step is unsafe", () => {
  const root = app();
  stamp(root, "0.0.1-next.3");
  const step = { version: "0.0.1-next.4", automatic: false, apply: () => { writeFileSync(path.join(root, "migrated"), "yes"); } };
  migrations.push(step);
  try {
    expect(() => ensureProjectVersion(root)).toThrow("Run spark upgrade");
    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(path.join(root, "migrated"))).toBe(false);
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe("0.0.1-next.3\n");
    migrateProject(root, version, false);
    expect(readFileSync(path.join(root, "migrated"), "utf8")).toBe("yes");
  } finally { migrations.pop(); }
});

test("failed idempotent migrations retain the old stamp and can retry", () => {
  const root = app();
  stamp(root, "0.0.1-next.3");
  let fail = true;
  migrations.push({ version: "0.0.1-next.4", automatic: true, apply: () => { if (fail) throw new Error("migration failed"); } });
  try {
    expect(() => migrateProject(root, version)).toThrow("migration failed");
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe("0.0.1-next.3\n");
    fail = false;
    migrateProject(root, version);
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
  } finally { migrations.pop(); }
});

test("invalid records, downgrades and a different installed CLI stop with upgrade guidance", () => {
  const root = app();
  for (const record of ["", "broken", "999.0.0"]) {
    stamp(root, record);
    expect(() => ensureProjectVersion(root)).toThrow("Run spark upgrade");
    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(false);
  }
  expect(() => ensureProjectVersion(app("999.0.0"))).toThrow("app's installed CLI");
});

test.each(["dev", "build", "doctor"])("spark %s refuses downgraded project state before starting tools", async command => {
  const root = app();
  stamp(root, "999.0.0");
  const child = spawnProcess([process.execPath, path.resolve("packages/cli/src/index.ts"), command, "--project", root], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(1);
  expect(out + err).toContain("Run spark upgrade");
  expect(existsSync(path.join(root, ".spark/commands.jsonl"))).toBe(false);
});
