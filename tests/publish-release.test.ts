import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";

const state = vi.hoisted(() => ({
  release: {} as any, commands: [] as string[][], checks: new Map<string, number>(),
  failCreate: false, visible: true, retry: false, draft: false, latest: true,
  tags: {} as Record<string, Record<string, string>>,
}));
vi.mock("../scripts/release-env.ts", () => ({ loadReleaseEnv: vi.fn() }));
vi.mock("../packages/cli/src/errors.ts", () => ({ releaseCommand: (_root: string, action: () => Promise<void>) => action() }));
vi.mock("../packages/cli/src/project.ts", () => ({ VERSION: "0.0.1-next.3", readJson: () => state.release }));
vi.mock("node:fs", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, readFileSync: (file: string, ...args: any[]) =>
    file.includes("/artifacts/releases/") ? Buffer.from("archive bytes") : (original.readFileSync as any)(file, ...args) };
});
vi.mock("../scripts/npm-release.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../scripts/npm-release.ts")>(),
  verifyCreatorArchive: vi.fn(),
  requireNpmTerminal: vi.fn(),
  alreadyPublished: async (_version: string, _archive: string, _execute: unknown, name: string) => {
    const count = state.checks.get(name) ?? 0;
    state.checks.set(name, count + 1);
    return count === 0 ? state.retry : state.visible || name === "@legendapp/spark";
  },
  publishAndWait: async (_root: string, release: { name: string; published: boolean }, _execute: unknown, publish: () => Promise<void>) => {
    if (!release.published) await publish();
    state.checks.set(release.name, (state.checks.get(release.name) ?? 0) + 1);
    if (!state.visible && release.name === "@legendapp/create-spark") throw new Error("not visible yet");
  },
  waitForReleaseTags: async (version: string, latest: boolean, _execute: unknown, _wait: unknown, name: string) => {
    expect(state.tags[name]![latest ? "latest" : "next"]).toBe(version);
  },
}));
vi.mock("../packages/cli/src/process.ts", () => ({ spawnProcess: (argv: string[]) => {
  state.commands.push(argv);
  const code = state.failCreate && argv[1] === "publish" && path.basename(argv[2]!) === "create-spark.tgz" ? 1 : 0;
  if (argv[1] === "publish" && !code) {
    const name = path.basename(argv[2]!) === "spark.tgz" ? "@legendapp/spark" : "@legendapp/create-spark";
    // npm publish moves its chosen dist-tag.
    state.tags[name]![argv[argv.indexOf("--tag") + 1]!] = state.release.version;
  }
  if (argv[1] === "dist-tag") {
    const name = argv[3]!.slice(0, argv[3]!.lastIndexOf("@"));
    expect(state.checks.get(name)).toBe(2);
    state.tags[name]![argv[4]!] = state.release.version;
  }
  return { exited: Promise.resolve(code) };
} }));
vi.mock("../packages/cli/src/commands.ts", () => ({ run: async (_root: string, argv: string[]) => {
  if (argv[0] === "git") return argv[1] === "rev-parse" ? state.release.revision : "";
  if (argv.includes("visibility")) return '{"visibility":"PUBLIC"}';
  if (argv[1] === "api" && argv[2]?.includes("git/ref")) return JSON.stringify({ object: { type: "commit", sha: state.release.revision } });
  if (argv[1] === "api") {
    state.commands.push(argv);
    const uploaded = { tag_name: `v${state.release.version}`, draft: state.draft,
      assets: [...Object.entries(state.release.sha256).map(([name, hash]) => ({ name, digest: `sha256:${hash}` })), { name: "checksums.txt" }, { name: "release.json" }] };
    if (argv[2]!.includes("/releases/tags/")) { if (state.draft) throw new Error("HTTP 404"); return JSON.stringify(uploaded); }
    return JSON.stringify([[uploaded]]);
  }
  if (argv.includes("dist-tags")) return JSON.stringify(state.tags[argv[2]!]);
  if (argv[1] === "release") return '{"isDraft":false}';
  return "";
} }));

afterEach(() => { vi.restoreAllMocks(); });

test.each(["success", "next only", "draft", "create failure", "not visible", "retry", "invalid creator", "no terminal"])("release publication publishes to its channel: %s", async scenario => {
  vi.resetModules();
  state.commands = [];
  state.checks.clear();
  state.failCreate = scenario === "create failure";
  state.visible = scenario !== "not visible";
  state.retry = scenario === "retry";
  state.draft = scenario === "draft";
  state.latest = scenario !== "next only";
  state.tags = {
    "@legendapp/spark": { next: "0.0.1-next.2", latest: "0.0.1-next.1" },
    "@legendapp/create-spark": { next: "0.0.1-next.2", latest: "0.0.1-next.1" },
  };
  const hash = createHash("sha256").update("archive bytes").digest("hex");
  state.release = { version: "0.0.1-next.3", revision: "a".repeat(40), npm: "spark.tgz", createNpm: "create-spark.tgz",
    sha256: { "spark.tgz": hash, "create-spark.tgz": hash, "runner-manifest.json": hash } };
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "publish-release.ts", ...(state.latest ? ["--latest"] : [])]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const helpers = await import("../scripts/npm-release.ts");
  vi.mocked(helpers.verifyCreatorArchive).mockReset();
  vi.mocked(helpers.requireNpmTerminal).mockReset();
  if (scenario === "invalid creator") vi.mocked(helpers.verifyCreatorArchive).mockImplementation(() => { throw new Error("Invalid creator release"); });
  if (scenario === "no terminal") vi.mocked(helpers.requireNpmTerminal).mockImplementation(() => { throw new Error("Requires TTYs"); });
  const publication = import("../scripts/publish-release.ts");
  if (scenario === "invalid creator" || scenario === "no terminal") {
    await expect(publication).rejects.toThrow(scenario === "invalid creator" ? "Invalid creator release" : "Requires TTYs");
    expect(state.commands).toEqual([]);
    return;
  }
  const api = () => state.commands.filter(argv => argv[0] === "gh").map(argv => argv[2]);
  const distTags = () => state.commands.filter(argv => argv[1] === "dist-tag").map(argv => argv.slice(3));
  if (state.failCreate || !state.visible) {
    await expect(publication).rejects.toThrow(state.failCreate ? "npm publish @legendapp/create-spark exited 1" : "not visible yet");
    // The SDK is already on its channel; the creator that pins it is not.
    expect(distTags()).toEqual([]);
    expect(state.tags["@legendapp/spark"]).toEqual({ next: "0.0.1-next.2", latest: "0.0.1-next.3" });
    expect(state.tags["@legendapp/create-spark"]).toEqual({ next: "0.0.1-next.2", latest: state.failCreate ? "0.0.1-next.1" : "0.0.1-next.3" });
  } else {
    await publication;
    expect(helpers.verifyCreatorArchive).toHaveBeenCalledWith(expect.any(String), state.release.version, expect.stringContaining("/artifacts/releases/0.0.1-next.3/create-spark.tgz"));
    expect(helpers.requireNpmTerminal).toHaveBeenCalledOnce();
    expect(api().filter(endpoint => endpoint!.includes("/releases"))).toEqual(state.draft
      ? ["repos/LegendApp/legend-spark/releases/tags/v0.0.1-next.3", "repos/LegendApp/legend-spark/releases"]
      : ["repos/LegendApp/legend-spark/releases/tags/v0.0.1-next.3"]);
    const publishes = state.commands.filter(argv => argv[1] === "publish");
    expect(publishes.map(argv => path.basename(argv[2]!))).toEqual(state.retry ? [] : ["spark.tgz", "create-spark.tgz"]);
    for (const argv of publishes) expect(argv.slice(-2)).toEqual(["--tag", state.latest ? "latest" : "next"]);
    // A publish moves only its channel; a resume repairs that channel and no other.
    expect(distTags()).toEqual(state.retry ? [["@legendapp/spark@0.0.1-next.3", "latest"], ["@legendapp/create-spark@0.0.1-next.3", "latest"]] : []);
    for (const tags of Object.values(state.tags)) expect(tags).toEqual(state.latest ? { next: "0.0.1-next.2", latest: "0.0.1-next.3" } : { next: "0.0.1-next.3", latest: "0.0.1-next.1" });
  }
});
