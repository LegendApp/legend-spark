import { sessionStatus } from "../packages/cli/src/session-status.ts";
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { VERSION, writeJson } from "../packages/cli/src/project.ts";
import { releaseBase, validateRelease, packageSources, materializeReleasePackages, verifyMaterializedReleasePackages, type ReleaseManifest, type RunnerAsset } from "../packages/cli/src/release.ts";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { downloadAsset, installRunner } from "../packages/cli/src/runner-install.ts";
import { applyOverrides, managerCommand } from "../packages/cli/src/package-manager.ts";
import { spawnProcess, which } from "../packages/cli/src/process.ts";

const bytes = Buffer.from("signed archive fixture");
const asset: RunnerAsset = { url: `${releaseBase(VERSION)}/runner.zip`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), app: "SparkRunner.app", teamId: "ABCDEFGHIJ", fingerprint: "abc123" };
function release(): ReleaseManifest { return { schema: 1, version: VERSION, revision: "a".repeat(40), packages: { "@react-native-runtimes/core": { ...asset, url: `${releaseBase(VERSION)}/runtimes.tgz` } }, runners: { "macos-arm64": asset } }; }
async function fixtureArchive(directory: string, packageName: string, marker: string) {
  mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "package.json"), { name: packageName, version: "1.2.3", main: "index.js", scripts: { postinstall: `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")'` } });
  writeFileSync(path.join(directory, "index.js"), "module.exports = 'verified archive';\n");
  const archive = path.join(path.dirname(directory), "fixture.tgz");
  await packArchive(directory, archive);
  return readFileSync(archive);
}
function packageRelease(name: string, archive: Uint8Array) {
  return { ...release(), packages: { [name]: { url: `${releaseBase(VERSION)}/fixture.tgz`, size: archive.byteLength, sha256: createHash("sha256").update(archive).digest("hex") } } };
}

test("published project dependencies use relative verified archive paths", () => {
  expect(packageSources(undefined, release())).toEqual({ "@legendapp/spark": VERSION, "@react-native-runtimes/core": `file:./spark-packages/react-native-runtimes-core-${asset.sha256}.tgz` });
  for (const change of [ { version: "wrong" }, { revision: "main" }, { runners: { "windows-x64": asset } }, { packages: { bad: { ...asset, url: "https://other.example/runner.zip" } } }, { runners: { "macos-arm64": { ...asset, app: "../escape.app" } } } ]) expect(() => validateRelease({ ...release(), ...change })).toThrow();
});

const installedManagers = (["npm", "pnpm", "yarn", "bun"] as const).filter(manager => which(manager));
test.each(installedManagers)("verified release archives install and reinstall after cloning with %s", async manager => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-release-packages-"));
  const clone = `${root}-clone`;
  const packageName = "@spark-fixture/patched";
  const marker = path.join(root, "lifecycle-marker");
  const archiveBytes = await fixtureArchive(path.join(root, "source"), packageName, marker);
  const releaseManifest = packageRelease(packageName, archiveBytes);
  const http = createServer((_request, response) => { response.writeHead(200); response.end(archiveBytes); });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw Error("Local fixture server did not start");
  let requests = 0;
  const request = (async () => { requests++; return fetch(`http://127.0.0.1:${address.port}/archive.tgz`); }) as typeof fetch;
  try {
    const consumer = path.join(root, "consumer"); mkdirSync(consumer);
    const source = packageSources(undefined, releaseManifest)[packageName]!;
    const pkg: any = { name: "fixture-consumer", version: "1.0.0", private: true, dependencies: { [packageName]: source }, ...(manager === "bun" ? { trustedDependencies: [packageName] } : {}) };
    applyOverrides(pkg, { [packageName]: source }, manager);
    writeJson(path.join(consumer, "package.json"), pkg);
    writeFileSync(path.join(consumer, ".gitignore"), "spark-packages\n!spark-packages/\n!spark-packages/**\n");
    if (manager === "pnpm") writeFileSync(path.join(consumer, "pnpm-workspace.yaml"), `packages: []\nallowBuilds:\n  "${packageName}": true\n`);
    await materializeReleasePackages(releaseManifest, consumer, request);
    verifyMaterializedReleasePackages(releaseManifest, consumer);
    expect(JSON.parse(execFileSync("tar", ["-xOzf", path.join(root, "fixture.tgz"), "package/package.json"], { encoding: "utf8" })).scripts.postinstall).toBeTypeOf("string");
    const templateArchive = path.join(root, "consumer-template.tgz");
    await packArchive(consumer, templateArchive);
    expect(execFileSync("tar", ["-tzf", templateArchive], { encoding: "utf8" })).toContain("package/spark-packages/");
    const cache = path.join(root, `${manager}-cache`);
    const args = manager === "npm" ? ["install", "--offline", "--no-audit", "--no-fund", "--foreground-scripts"] : manager === "pnpm" ? ["install", "--offline", "--store-dir", cache, "--config.strictDepBuilds=false"] : manager === "yarn" ? ["install", "--offline", "--non-interactive", "--no-default-rc", "--cache-folder", cache] : ["install", `--cache-dir=${cache}`];
    let managerInvocations = 0;
    async function install(at: string) {
      verifyMaterializedReleasePackages(releaseManifest, at);
      managerInvocations++;
      const child = spawnProcess(managerCommand(manager, args, {}), { cwd: at, env: { ...process.env, CI: "1", ...(manager === "npm" ? { npm_config_cache: cache } : {}) }, stdout: "pipe", stderr: "pipe" });
      const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout!).text(), new Response(child.stderr!).text()]);
      if (status !== 0) throw new Error(`${manager} install failed (${status}):\n${stderr}\n${stdout}`);
    }
    async function assertInstalled(at: string) {
      const require = createRequire(path.join(at, "package.json"));
      expect(require(packageName)).toBe("verified archive");
    }
    await install(consumer);
    await assertInstalled(consumer);
    rmSync(marker, { force: true });
    cpSync(consumer, clone, { recursive: true, filter: sourcePath => {
      const relative = path.relative(consumer, sourcePath);
      return !relative.split(path.sep).includes("node_modules");
    } });
    await install(clone);
    await assertInstalled(clone);
    expect(existsSync(marker)).toBe(manager !== "pnpm");
    expect(pkg.dependencies[packageName]).toMatch(/^file:\.\/spark-packages\//);
    expect(requests).toBe(1);
    expect(managerInvocations).toBe(2);
  } finally { http.close(); rmSync(root, { recursive: true, force: true }); rmSync(clone, { recursive: true, force: true }); }
}, 120_000);

test("corrupt release bytes are rejected before archives become installable", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-release-corrupt-"));
  const packageName = "@spark-fixture/corrupt";
  const marker = path.join(root, "lifecycle-marker");
  const archiveBytes = await fixtureArchive(path.join(root, "source"), packageName, marker);
  const releaseManifest = packageRelease(packageName, archiveBytes);
  let managerInvocations = 0;
  const http = createServer((_request, response) => { response.writeHead(200); response.end("tampered"); });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); if (!address || typeof address === "string") throw Error("Local fixture server did not start");
  const request = (() => fetch(`http://127.0.0.1:${address.port}/archive.tgz`)) as typeof fetch;
  try {
    async function installAfterVerification() {
      await materializeReleasePackages(releaseManifest, root, request);
      verifyMaterializedReleasePackages(releaseManifest, root);
      managerInvocations++;
    }
    await expect(installAfterVerification()).rejects.toThrow("checksum or size mismatch");
    expect(managerInvocations).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(root, "spark-packages"))).toBe(true);
    expect(readdirSync(path.join(root, "spark-packages"))).toEqual([]);
  } finally { http.close(); rmSync(root, { recursive: true, force: true }); }
});

test("oversized streams and modified cached archives are rejected and partial files are removed", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-release-size-"));
  let requests = 0;
  const oversized = (async () => { requests++; return new Response(Buffer.alloc(bytes.length + 1)); }) as typeof fetch;
  const valid = (async () => { requests++; return new Response(bytes); }) as typeof fetch;
  const archive = path.join(root, "spark-packages", `react-native-runtimes-core-${asset.sha256}.tgz`);
  try {
    await expect(materializeReleasePackages(release(), root, oversized)).rejects.toThrow("exceeds its declared size");
    expect(readdirSync(path.join(root, "spark-packages"))).toEqual([]);
    await materializeReleasePackages(release(), root, valid);
    expect(requests).toBe(2);
    writeFileSync(archive, "modified after validation");
    await expect(materializeReleasePackages(release(), root, valid)).rejects.toThrow("Existing verified Spark package archive is corrupt");
    expect(requests).toBe(2);
    expect(readdirSync(path.join(root, "spark-packages"))).toEqual([path.basename(archive)]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Runner download retries interrupted streams and rejects mismatched bytes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-download-"));
  let calls = 0;
  const request = (async () => { calls++; if (calls === 1) throw new Error("connection reset"); return new Response(bytes); }) as typeof fetch;
  try {
    await downloadAsset(asset, path.join(root, "valid"), request);
    expect(calls).toBe(2); expect(readFileSync(path.join(root, "valid"))).toEqual(bytes);
    await expect(downloadAsset({ ...asset, sha256: "0".repeat(64) }, path.join(root, "invalid"), request)).rejects.toThrow("checksum");
    expect(existsSync(path.join(root, "invalid"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each(["arm64", "x64"])("Runner %s installs atomically and verifies cached apps and publisher signatures", async (arch) => {
  const previousArch = process.env.SPARK_MACOS_ARCH; process.env.SPARK_MACOS_ARCH = arch;
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-runner-install-"));
  const previous = process.env.SPARK_HOME; process.env.SPARK_HOME = root;
  let downloads = 0, rejected = false;
  const commands: string[][] = [];
  const deps = {
    fetch: (async () => { downloads++; return new Response(bytes); }) as typeof fetch,
    run: async (_root: string, argv: string[]) => {
      commands.push(argv);
      if (argv[0] === "ditto") {
        const app = path.join(argv.at(-1)!, asset.app);
        mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
        writeJson(path.join(app, "Contents/Resources/spark-runtime.json"), { schema: 1, framework: VERSION, platform: "macos", arch, mode: "go", fingerprint: asset.fingerprint, modules: {} });
      }
      if (argv[0] === "codesign" && argv.includes("-dvvv")) return `Authority=Developer ID Application: Test\nTeamIdentifier=${rejected ? "WRONGTEAM1" : asset.teamId}\n`;
      return "";
    },
  };
  try {
    const app = await installRunner(asset, root, deps);
    expect(existsSync(app)).toBe(true); expect(downloads).toBe(1);
    expect(await installRunner(asset, root, deps)).toBe(app); expect(downloads).toBe(1);
    expect(commands.some(args => args[0] === "spctl")).toBe(true);
    expect(commands.some(args => args[0] === "xcrun")).toBe(false);
    rmSync(path.join(root, "runtimes"), { recursive: true });
    rejected = true;
    await expect(installRunner(asset, root, deps)).rejects.toThrow("publisher signature");
    expect(existsSync(path.join(root, "runtimes"))).toBe(false);
    expect(existsSync(app)).toBe(false);
  } finally { if (previousArch === undefined) delete process.env.SPARK_MACOS_ARCH; else process.env.SPARK_MACOS_ARCH = previousArch; if (previous === undefined) delete process.env.SPARK_HOME; else process.env.SPARK_HOME = previous; rmSync(root, { recursive: true, force: true }); }
});

test("published SDK sessions explain automatic Runner installation", () => {
  expect(sessionStatus("go", false, [], false, true).actions).toContain("Download and open");
  expect(sessionStatus("go", false, [], false, false).message).toContain("register");
});

test("release manifests accept both macOS Runner architectures", () => {
  const manifest = release();
  manifest.runners["macos-x64"] = asset;
  expect(validateRelease(manifest).runners["macos-x64"]).toEqual(asset);
});
