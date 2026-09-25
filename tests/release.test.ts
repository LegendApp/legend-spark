import { sessionStatus } from "../packages/cli/src/session-status.ts";
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERSION, writeJson } from "../packages/cli/src/project.ts";
import { releaseBase, validateRelease, packageSources, type ReleaseManifest, type RunnerAsset } from "../packages/cli/src/release.ts";
import { downloadAsset, installRunner } from "../packages/cli/src/runner-install.ts";

const bytes = Buffer.from("signed archive fixture");
const asset: RunnerAsset = { url: `${releaseBase(VERSION)}/runner.zip`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), app: "SparkRunner.app", teamId: "ABCDEFGHIJ", fingerprint: "abc123" };
function release(): ReleaseManifest { return { schema: 1, version: VERSION, revision: "a".repeat(40), packages: { "@react-native-runtimes/core": { ...asset, url: `${releaseBase(VERSION)}/runtimes.tgz` } }, runners: { "macos-arm64": asset } }; }

test("published project dependencies have registry versions and immutable release URLs", () => {
  expect(packageSources(undefined, release())).toEqual({ "@legendapp/spark": VERSION, "@react-native-runtimes/core": `${releaseBase(VERSION)}/runtimes.tgz` });
  for (const change of [ { version: "wrong" }, { revision: "main" }, { runners: { "windows-x64": asset } }, { packages: { bad: { ...asset, url: "https://other.example/runner.zip" } } }, { runners: { "macos-arm64": { ...asset, app: "../escape.app" } } } ]) expect(() => validateRelease({ ...release(), ...change })).toThrow();
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
