import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { linkCommand, runtimeFixture, runtimes, type RuntimeName } from "./helpers/js-runtimes.ts";

const source = path.resolve(import.meta.dirname, "../packages/cli/src");
const shell = test.skipIf(process.platform === "win32");
function fixture(names: RuntimeName[] = []) {
  const f = runtimeFixture(names);
  const { root, bin, env } = f;
  for (const name of ["runtime-bootstrap.sh", "runtime-downloads.tsv", "js-runtime.cjs"]) cpSync(path.join(source, name), path.join(root, name));
  const entry = path.join(root, "entry.cjs");
  writeFileSync(entry, "console.log(JSON.stringify({runtime:process.versions.bun?'bun':'node',args:process.argv.slice(2)}))");
  const args = [path.join(root, "runtime-bootstrap.sh"), entry, "two words", "$(never-execute)"];
  const run = (overrides = {}) => spawnSync("/bin/sh", args, { env: { ...env, ...overrides }, encoding: "utf8" });
  return { ...f, args, run };
}
function downloadFixture(name: RuntimeName = runtimes[0]!.name) {
  const f = fixture();
  const runtime = runtimes.find(runtime => runtime.name === name)!;
  f.env.SPARK_RUNTIME_DOWNLOAD = name === "bun" ? "" : "node";
  const unpacked = path.join(f.root, "archive"); mkdirSync(unpacked);
  // A tiny executable archive keeps downloader tests offline; real runtime
  // compatibility is exercised separately against each installed engine.
  writeFileSync(path.join(unpacked, name), `#!/bin/sh\nexec '${runtime.executable.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  const archive = path.join(f.root, name === "bun" ? "runtime.zip" : "runtime.tar.gz");
  expect(name === "bun" ? spawnSync("zip", ["-j", "-q", archive, path.join(unpacked, name)]).status : spawnSync("tar", ["-czf", archive, "-C", unpacked, name]).status).toBe(0);
  const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(path.join(f.root, "runtime-downloads.tsv"), `runtime\tversion\tplatform\tarch\turl\tsha256\texecutable\n${name}\t${runtime.version}\t${process.platform}\t${process.arch}\thttps://example.invalid/${path.basename(archive)}\t${checksum}\t${name}\n`);
  rmSync(path.join(f.bin, "curl"));
  writeFileSync(path.join(f.bin, "curl"), `#!/bin/sh\nset -eu\necho download >> "$SPARK_HOME/downloads"\nwhile [ "$1" != --output ]; do shift; done\ncp "$SPARK_TEST_ARCHIVE" "$2"\n`, { mode: 0o755 });
  Object.assign(f.env, { SPARK_TEST_ARCHIVE: archive });
  const destination = path.join(f.env.SPARK_HOME, "tooling/runtimes", `${name}-${runtime.version}-${process.platform}-${process.arch}-${checksum}`);
  return { ...f, archive, destination };
}

shell.each(runtimes)("bootstrap reuses installed $name without downloading", ({ name }) => {
  const f = fixture([name]);
  try {
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ runtime: name, args: ["two words", "$(never-execute)"] });
    expect(existsSync(f.env.SPARK_HOME)).toBe(false);
  } finally { f.dispose(); }
});

shell.each(runtimes)("bootstrap downloads $name once, reuses its cache, and repairs an altered executable", ({ name }) => {
  const f = downloadFixture(name);
  try {
    for (let i = 0; i < 2; i++) {
      const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).runtime).toBe(name);
      expect(JSON.parse(result.stdout).args).toEqual(["two words", "$(never-execute)"]);
    }
    expect(readFileSync(path.join(f.env.SPARK_HOME, "downloads"), "utf8")).toBe("download\n");
    writeFileSync(path.join(f.destination, name), "#!/bin/sh\nexit 90\n");
    const repaired = f.run();
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(readFileSync(path.join(f.env.SPARK_HOME, "downloads"), "utf8")).toBe("download\ndownload\n");
    expect(readdirSync(path.dirname(f.destination))).toEqual([path.basename(f.destination)]);
  } finally { f.dispose(); }
});

test.skipIf(process.platform === "win32" || runtimes.length !== 2)("bootstrap prefers installed and cached Bun, while honoring an explicit Node override", () => {
  const f = fixture(["node", "bun"]);
  const cached = downloadFixture("bun");
  try {
    expect(JSON.parse(f.run().stdout).runtime).toBe("bun");
    expect(JSON.parse(f.run({ SPARK_JS_RUNTIME: "node" }).stdout).runtime).toBe("node");
    const downloaded = cached.run();
    expect(downloaded.status, downloaded.stderr).toBe(0);
    linkCommand(runtimes.find(runtime => runtime.name === "node")!.executable, cached.bin, "node");
    expect(JSON.parse(cached.run().stdout).runtime).toBe("bun");
    expect(readFileSync(path.join(cached.env.SPARK_HOME, "downloads"), "utf8")).toBe("download\n");
  } finally { f.dispose(); cached.dispose(); }
});

shell("bootstrap rejects a corrupt download before extracting or executing it", () => {
  const f = downloadFixture();
  try {
    writeFileSync(f.archive, "not the pinned archive");
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checksum mismatch");
    expect(readdirSync(path.dirname(f.destination))).toEqual([]);
  } finally { f.dispose(); }
});

shell("a crashed installer reports its abandoned lock without deleting another install's state", () => {
  const f = downloadFixture();
  try {
    mkdirSync(`${f.destination}.lock`, { recursive: true });
    writeFileSync(path.join(`${f.destination}.lock`, "pid"), "2147483647\n");
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Remove ${f.destination}.lock and retry`);
    expect(existsSync(`${f.destination}.lock`)).toBe(true);
    expect(existsSync(path.join(f.env.SPARK_HOME, "downloads"))).toBe(false);
  } finally { f.dispose(); }
});

shell("concurrent bootstraps publish one verified installation", async () => {
  const f = downloadFixture();
  try {
    const children = [0, 1].map(() => spawnProcess(["/bin/sh", ...f.args], { env: f.env }));
    const results = await Promise.all(children.map(async child => {
      const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
      expect(code, err).toBe(0);
    }));
    expect(results).toHaveLength(2);
    expect(readFileSync(path.join(f.env.SPARK_HOME, "downloads"), "utf8")).toBe("download\n");
  } finally { f.dispose(); }
});

test("every pinned runtime download has an HTTPS URL and SHA-256 digest", () => {
  const rows = readFileSync(path.join(source, "runtime-downloads.tsv"), "utf8").trim().split("\n").slice(1);
  for (const row of rows) {
    const [name, version, platform, arch, url, sha, executable] = row.split("\t");
    expect(["node", "bun"]).toContain(name);
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(["darwin", "linux", "win32"]).toContain(platform);
    expect(["arm64", "x64"]).toContain(arch);
    expect(url).toMatch(/^https:\/\//);
    expect(sha).toMatch(/^[a-f0-9]{64}$/);
    expect(executable).not.toContain("..");
  }
});
