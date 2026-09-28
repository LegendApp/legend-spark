import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { spawnProcess, which } from "../packages/cli/src/process.ts";

const source = path.resolve(import.meta.dirname, "../packages/cli/src");
const shell = test.skipIf(process.platform === "win32");
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark bootstrap "));
  const bin = path.join(root, "bin"); mkdirSync(bin);
  for (const name of ["runtime-bootstrap.sh", "js-runtime.cjs"]) cpSync(path.join(source, name), path.join(root, name));
  const entry = path.join(root, "entry.cjs");
  writeFileSync(entry, "console.log(JSON.stringify({runtime:process.versions.bun?'bun':'node',args:process.argv.slice(2)}))");
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, SPARK_JS_RUNTIME: "", SPARK_RUNTIME_DOWNLOAD: "", SPARK_HOME: path.join(root, "home") };
  const args = [path.join(root, "runtime-bootstrap.sh"), entry, "two words", "$(never-execute)"];
  const run = (overrides = {}) => spawnSync("/bin/sh", args, { env: { ...env, ...overrides }, encoding: "utf8" });
  return { root, bin, args, env, run, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
function downloadFixture() {
  const f = fixture();
  const unpacked = path.join(f.root, "archive"); mkdirSync(unpacked);
  // A tiny executable archive keeps downloader tests offline; real runtime
  // compatibility is exercised separately against each installed engine.
  writeFileSync(path.join(unpacked, "node"), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  const archive = path.join(f.root, "runtime.tar.gz");
  expect(spawnSync("tar", ["-czf", archive, "-C", unpacked, "node"]).status).toBe(0);
  const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  writeFileSync(path.join(f.root, "runtime-downloads.tsv"), `runtime\tversion\tplatform\tarch\turl\tsha256\texecutable\nnode\t24.19.0\t${process.platform}\t${process.arch}\thttps://example.invalid/runtime.tar.gz\t${checksum}\tnode\n`);
  writeFileSync(path.join(f.bin, "curl"), `#!/bin/sh\nset -eu\necho download >> "$SPARK_HOME/downloads"\nwhile [ "$1" != --output ]; do shift; done\ncp "$SPARK_TEST_ARCHIVE" "$2"\n`, { mode: 0o755 });
  Object.assign(f.env, { SPARK_TEST_ARCHIVE: archive });
  const destination = path.join(f.env.SPARK_HOME, "tooling/runtimes", `node-24.19.0-${process.platform}-${process.arch}-${checksum}`);
  return { ...f, archive, destination };
}

shell.each(["node", "bun"].filter(name => which(name)))("bootstrap reuses installed %s without downloading", name => {
  const f = fixture();
  try {
    symlinkSync(which(name)!, path.join(f.bin, name));
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ runtime: name, args: ["two words", "$(never-execute)"] });
    expect(existsSync(f.env.SPARK_HOME)).toBe(false);
  } finally { f.dispose(); }
});

shell("bootstrap downloads once, reuses its cache, and repairs an altered executable", () => {
  const f = downloadFixture();
  try {
    for (let i = 0; i < 2; i++) {
      const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).args).toEqual(["two words", "$(never-execute)"]);
    }
    expect(readFileSync(path.join(f.env.SPARK_HOME, "downloads"), "utf8")).toBe("download\n");
    writeFileSync(path.join(f.destination, "node"), "#!/bin/sh\nexit 90\n");
    const repaired = f.run();
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(readFileSync(path.join(f.env.SPARK_HOME, "downloads"), "utf8")).toBe("download\ndownload\n");
    expect(readdirSync(path.dirname(f.destination))).toEqual([path.basename(f.destination)]);
  } finally { f.dispose(); }
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
