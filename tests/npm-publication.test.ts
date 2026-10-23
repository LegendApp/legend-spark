import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { latestChannel, publishAndWait, waitForPublication, waitForReleaseTags } from "../scripts/npm-release.ts";
import type { Execute } from "../scripts/release-workflow.ts";

let root: string;
let release: { version: string; revision: string; archive: string; published: boolean };
let ready: { code: number; output: string };
const pending = { code: 1, output: "npm error E404" };
const receiptPath = () => path.join(root, ".spark/npm-publications", `${release.version}.json`);

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "spark-npm-publication-"));
  const archive = path.join(root, "spark.tgz");
  writeFileSync(archive, "exact release archive");
  release = { version: "0.0.1-next.3", revision: "release-source", archive, published: false };
  ready = { code: 0, output: JSON.stringify({ version: release.version, "dist.integrity": `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}` }) };
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

test("successful submission polls every 15s until the exact archive is available", async () => {
  const execute = vi.fn<Execute>().mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValue(ready);
  const wait = vi.fn().mockResolvedValue(undefined);
  const publish = vi.fn().mockResolvedValue(undefined);
  await publishAndWait(root, release, execute, publish, wait);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(3);
  expect(wait.mock.calls).toEqual([[15_000], [15_000]]);
  expect(execute.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["--prefer-online", "--fetch-retries=0", "--fetch-timeout=15000"]));
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Checking again in 15s"));
  expect(existsSync(receiptPath())).toBe(true);
});

test("resuming a submitted but invisible version waits without publishing again", async () => {
  const paused = new Error("interrupted");
  const publish = vi.fn().mockResolvedValue(undefined);
  await expect(publishAndWait(root, release, async () => pending, publish, async () => { throw paused; })).rejects.toBe(paused);
  expect(JSON.parse(readFileSync(receiptPath(), "utf8"))).toMatchObject({ version: release.version, revision: release.revision });
  const execute = vi.fn<Execute>().mockResolvedValueOnce(pending).mockResolvedValue(ready);
  const wait = vi.fn().mockResolvedValue(undefined);
  await publishAndWait(root, release, execute, publish, wait);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenCalledWith(15_000);
});

test("already available releases skip publication, including recovery from older scripts", async () => {
  const publish = vi.fn();
  const wait = vi.fn();
  await publishAndWait(root, { ...release, published: true }, async () => ready, publish, wait);
  expect(publish).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});

test("failed submission is not recorded as accepted or polled", async () => {
  const failure = new Error("npm publish failed");
  const execute = vi.fn<Execute>();
  await expect(publishAndWait(root, release, execute, async () => { throw failure; }, vi.fn())).rejects.toBe(failure);
  expect(existsSync(receiptPath())).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test.each(["archive", "revision"])("a submitted release refuses a changed %s before resubmission", async input => {
  await publishAndWait(root, release, async () => ready, async () => {}, vi.fn());
  if (input === "archive") writeFileSync(release.archive, "changed bytes");
  else release.revision = "changed-source";
  const publish = vi.fn();
  const execute = vi.fn<Execute>();
  await expect(publishAndWait(root, release, execute, publish, vi.fn())).rejects.toThrow("inputs changed");
  expect(publish).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

test("temporary network failures retry availability, while auth and integrity failures stop", async () => {
  const execute = vi.fn<Execute>().mockResolvedValueOnce({ code: 1, output: "npm error ENOTFOUND registry.npmjs.org" }).mockResolvedValue(ready);
  const wait = vi.fn().mockResolvedValue(undefined);
  await waitForPublication(release.version, release.archive, execute, wait);
  expect(wait).toHaveBeenCalledWith(15_000);
  wait.mockClear();
  await expect(waitForPublication(release.version, release.archive, async () => ({ code: 1, output: "npm error E401 Unauthorized" }), wait)).rejects.toThrow("E401");
  await expect(waitForPublication(release.version, release.archive, async () => ({ code: 0, output: JSON.stringify({ version: release.version, "dist.integrity": "wrong" }) }), wait)).rejects.toThrow("different bytes");
  expect(wait).not.toHaveBeenCalled();
});

test("the channel defaults from the version and flags override it", () => {
  expect(latestChannel("0.0.1", {})).toBe(true);
  expect(latestChannel("0.0.1-next.8", {})).toBe(false);
  expect(latestChannel("0.0.1-next.8", { latest: true })).toBe(true);
  expect(latestChannel("0.0.1", { next: true })).toBe(false);
  expect(() => latestChannel("0.0.1", { latest: true, next: true })).toThrow("Choose either --latest or --next");
});

test("tag propagation polls until the release channel matches", async () => {
  const execute = vi.fn<Execute>()
    .mockResolvedValueOnce({ code: 1, output: "npm error ETIMEDOUT" })
    .mockResolvedValueOnce({ code: 0, output: JSON.stringify({ next: release.version, latest: "0.0.1-next.2" }) })
    .mockResolvedValue({ code: 0, output: JSON.stringify({ next: "0.0.1-next.2", latest: release.version }) });
  const wait = vi.fn().mockResolvedValue(undefined);
  await waitForReleaseTags(release.version, true, execute, wait);
  expect(wait.mock.calls).toEqual([[15_000], [15_000]]);
  expect(execute).toHaveBeenCalledTimes(3);
});

test("next releases do not wait for latest, and tag auth errors do not spin", async () => {
  const wait = vi.fn();
  await waitForReleaseTags(release.version, false, async () => ({ code: 0, output: JSON.stringify({ next: release.version, latest: "old" }) }), wait);
  await expect(waitForReleaseTags(release.version, true, async () => ({ code: 1, output: "npm error E401" }), wait)).rejects.toThrow("E401");
  expect(wait).not.toHaveBeenCalled();
});

test("SDK and creator submission receipts recover independently after an interruption", async () => {
  const sdkPublish = vi.fn().mockResolvedValue(undefined);
  await expect(publishAndWait(root, release, async () => pending, sdkPublish, async () => { throw new Error("paused"); })).rejects.toThrow("paused");
  const pkg = path.join(root, "creator-pack/package");
  mkdirSync(path.join(pkg, "dist"), { recursive: true });
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@legendapp/create-spark", version: release.version }));
  writeFileSync(path.join(pkg, "dist/release.json"), JSON.stringify({ version: release.version }));
  const releaseDir = path.join(root, "artifacts/releases", release.version);
  mkdirSync(releaseDir, { recursive: true });
  const creatorArchive = path.join(releaseDir, "creator.tgz");
  execFileSync("tar", ["-czf", creatorArchive, "-C", path.join(root, "creator-pack"), "package"]);
  const creator = { ...release, name: "@legendapp/create-spark", archive: creatorArchive };
  const creatorReady = { code: 0, output: JSON.stringify({ version: release.version, "dist.integrity": `sha512-${createHash("sha512").update(readFileSync(creatorArchive)).digest("base64")}` }) };
  const creatorPublish = vi.fn().mockResolvedValue(undefined);
  const execute = vi.fn<Execute>().mockResolvedValueOnce(pending).mockResolvedValue(creatorReady);
  await publishAndWait(root, creator, execute, creatorPublish, vi.fn().mockResolvedValue(undefined));
  expect(execute.mock.calls[0]?.[0]).toContain(`@legendapp/create-spark@${release.version}`);
  expect(readdirSync(path.join(root, ".spark/npm-publications"))).toHaveLength(2);
  await publishAndWait(root, release, async () => ready, sdkPublish, vi.fn());
  await publishAndWait(root, creator, async () => creatorReady, creatorPublish, vi.fn());
  expect(sdkPublish).toHaveBeenCalledTimes(1);
  expect(creatorPublish).toHaveBeenCalledTimes(1);
});

test("older SDK receipts remain valid without a package name", async () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  await publishAndWait(root, release, async () => ready, publish, vi.fn());
  const receipt = JSON.parse(readFileSync(receiptPath(), "utf8"));
  delete receipt.name;
  writeFileSync(receiptPath(), JSON.stringify(receipt));
  await publishAndWait(root, release, async () => ready, publish, vi.fn());
  expect(publish).toHaveBeenCalledTimes(1);
});

test("creator tag verification waits for the creator rather than the SDK", async () => {
  const execute = vi.fn<Execute>().mockResolvedValueOnce({ code: 0, output: '{"next":"old"}' })
    .mockResolvedValue({ code: 0, output: JSON.stringify({ next: release.version }) });
  const wait = vi.fn().mockResolvedValue(undefined);
  await waitForReleaseTags(release.version, false, execute, wait, "@legendapp/create-spark");
  expect(execute.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["npm", "view", "@legendapp/create-spark", "dist-tags"]));
  expect(wait).toHaveBeenCalledWith(15_000);
});
