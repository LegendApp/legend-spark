import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";

const state = vi.hoisted(() => ({
  release: {} as any, commands: [] as string[][], checks: new Map<string, number>(),
  failCreate: false, visible: true, retry: false, draft: false, latest: true,
  newRelease: false, tagError: "", failPush: false, moved: false,
  tags: {} as Record<string, Record<string, string>>,
}));
vi.mock("../scripts/release-env.ts", () => ({ loadReleaseEnv: vi.fn() }));
vi.mock("../packages/cli/src/errors.ts", async importOriginal => ({ ...await importOriginal<typeof import("../packages/cli/src/errors.ts")>(), releaseCommand: (_root: string, action: () => Promise<void>) => action() }));
vi.mock("../packages/cli/src/project.ts", () => ({ get VERSION() { return state.release.version; }, readJson: () => state.release }));
vi.mock("node:fs", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, writeFileSync: vi.fn(), readFileSync: (file: string, ...args: any[]) =>
    file.includes("/artifacts/releases/") ? Buffer.from("archive bytes") : file.endsWith("/CHANGELOG.md") ? `# Changelog\n\n## ${state.release.version}\n\nReviewed release notes.\n` : (original.readFileSync as any)(file, ...args) };
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
  const tagRead = argv.includes("dist-tags");
  const code = (tagRead && state.tagError) || (state.failCreate && argv[1] === "publish" && path.basename(argv[2]!) === "create-spark.tgz") ? 1 : 0;
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
  return { exited: Promise.resolve(code),
    stdout: new Blob([tagRead && !code ? JSON.stringify(state.tags[argv[2]!]) : ""]).stream(),
    stderr: new Blob([tagRead && code ? `npm error ${state.tagError}` : ""]).stream(),
  };
} }));
vi.mock("../packages/cli/src/commands.ts", () => ({ run: async (_root: string, argv: string[]) => {
  if (argv[0] === "git") {
    if (argv[1] === "push") { state.commands.push(argv); if (state.failPush && argv.includes("--atomic")) throw new Error("push rejected"); }
    if (argv[1] === "merge-base") { state.commands.push(argv); if (state.moved) throw new Error("not an ancestor"); }
    return argv[1] === "rev-parse" ? state.release.revision : "";
  }
  if (argv.includes("visibility")) return '{"visibility":"PUBLIC"}';
  if (argv[1] === "api" && argv[2]?.includes("git/ref")) return JSON.stringify({ object: { type: "commit", sha: state.release.revision } });
  if (argv[1] === "api") {
    state.commands.push(argv);
    const uploaded = { tag_name: `v${state.release.version}`, draft: state.draft,
      assets: [...Object.entries(state.release.sha256).map(([name, hash]) => ({ name, digest: `sha256:${hash}` })), { name: "checksums.txt" }, { name: "release.json" }] };
    if (argv[2]!.includes("/releases/tags/")) { if (state.draft) throw new Error("HTTP 404"); return JSON.stringify(uploaded); }
    return JSON.stringify([[uploaded]]);
  }
  if (argv.includes("dist-tags")) throw new Error("Registry reads must use registryCommand");
  if (argv[1] === "release") {
    state.commands.push(argv);
    if (argv[2] === "view" && state.newRelease) throw new Error("release not found");
    return JSON.stringify({ isDraft: state.draft });
  }
  return "";
} }));

afterEach(() => { vi.restoreAllMocks(); });

test.each(["success", "next only", "draft", "stable", "stable draft", "stable next draft", "new preview", "new stable", "E404 tags", "E401 tags", "create failure", "not visible", "push failure", "main moved", "moved retry draft", "retry", "invalid creator", "no terminal"])("release publication publishes to its channel: %s", async scenario => {
  vi.resetModules();
  state.commands = [];
  state.checks.clear();
  state.failCreate = scenario === "create failure";
  state.visible = scenario !== "not visible";
  state.retry = scenario === "retry" || scenario === "moved retry draft";
  state.moved = scenario.includes("moved");
  state.newRelease = scenario.startsWith("new ") || scenario === "push failure";
  state.failPush = scenario === "push failure" || scenario === "moved retry draft";
  state.draft = scenario.includes("draft") || state.newRelease;
  state.latest = scenario !== "next only" && scenario !== "stable next draft";
  state.tagError = scenario.endsWith(" tags") ? scenario.slice(0, 4) : "";
  const version = scenario.includes("stable") ? "0.0.1" : "0.0.1-next.3";
  state.tags = {
    "@legendapp/spark": { next: "0.0.1-next.2", latest: "0.0.1-next.1" },
    "@legendapp/create-spark": { next: "0.0.1-next.2", latest: "0.0.1-next.1" },
  };
  const hash = createHash("sha256").update("archive bytes").digest("hex");
  state.release = { version, revision: "a".repeat(40), npm: "spark.tgz", createNpm: "create-spark.tgz",
    sha256: { "spark.tgz": hash, "create-spark.tgz": hash, "runner-manifest.json": hash } };
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "publish-release.ts", ...(scenario === "stable next draft" ? ["--next"] : state.latest && version.includes("-") ? ["--latest"] : [])]);
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
  if (scenario === "E401 tags") {
    await expect(publication).rejects.toThrow("E401");
    expect(state.commands.some(argv => argv[1] === "dist-tag")).toBe(false);
    return;
  }
  const api = () => state.commands.filter(argv => argv[0] === "gh").map(argv => argv[2]);
  const distTags = () => state.commands.filter(argv => argv[1] === "dist-tag").map(argv => argv.slice(3));
  // Nothing goes public on GitHub (main, tag, release) until npm has both packages.
  const order = () => state.commands.map(argv => argv[0] === "git" ? argv[1] === "push" ? argv.includes("--atomic") ? "push" : "push tag" : argv[1] : argv[0] === "npm" && argv[1] === "publish" ? `npm ${path.basename(argv[2]!)}` : argv[1] === "release" && argv[2] !== "view" ? argv[2] : undefined).filter(Boolean);
  if (scenario === "main moved") {
    await expect(publication).rejects.toThrow("Nothing was published");
    expect(order()).toEqual(["merge-base"]);
    return;
  }
  if (state.failPush) {
    // npm is live: the tag and release still go public; main is left to the maintainer.
    await expect(publication).rejects.toThrow("push main");
    expect(order()).toEqual(state.retry ? ["push", "push tag", "edit"] : ["merge-base", "create", "upload", "npm spark.tgz", "npm create-spark.tgz", "push", "push tag", "edit"]);
    return;
  }
  if (state.failCreate || !state.visible) {
    await expect(publication).rejects.toThrow(state.failCreate ? "npm publish @legendapp/create-spark exited 1" : "not visible yet");
    // The SDK is already on its channel; the creator that pins it is not.
    expect(distTags()).toEqual([]);
    expect(order().filter(step => step === "push" || step === "edit")).toEqual([]);
    expect(state.tags["@legendapp/spark"]).toEqual({ next: "0.0.1-next.2", latest: "0.0.1-next.3" });
    expect(state.tags["@legendapp/create-spark"]).toEqual({ next: "0.0.1-next.2", latest: state.failCreate ? "0.0.1-next.1" : "0.0.1-next.3" });
  } else {
    await publication;
    expect(helpers.verifyCreatorArchive).toHaveBeenCalledWith(expect.any(String), version, expect.stringContaining(`/artifacts/releases/${version}/create-spark.tgz`));
    expect(helpers.requireNpmTerminal).toHaveBeenCalledOnce();
    expect(api().filter(endpoint => endpoint!.includes("/releases"))).toEqual(state.draft
      ? [`repos/LegendApp/legend-spark/releases/tags/v${version}`, "repos/LegendApp/legend-spark/releases"]
      : [`repos/LegendApp/legend-spark/releases/tags/v${version}`]);
    const edits = state.commands.filter(argv => argv[1] === "release" && argv[2] === "edit");
    expect(edits).toHaveLength(state.draft ? 1 : 0);
    const creates = state.commands.filter(argv => argv[1] === "release" && argv[2] === "create");
    expect(creates).toHaveLength(state.newRelease ? 1 : 0);
    for (const argv of creates) expect(argv).toContain("--draft");
    expect(order()).toEqual([...state.retry ? [] : ["merge-base"], ...state.newRelease ? ["create", "upload"] : [], ...state.retry ? [] : ["npm spark.tgz", "npm create-spark.tgz"], "push", ...state.draft ? ["edit"] : []]);
    for (const argv of [...creates, ...edits]) {
      expect(argv).toContain(version.includes("-") ? "--prerelease" : "--prerelease=false");
      expect(argv).toContain(version.includes("-") ? "--latest=false" : "--latest");
    }
    const publishes = state.commands.filter(argv => argv[1] === "publish");
    expect(publishes.map(argv => path.basename(argv[2]!))).toEqual(state.retry ? [] : ["spark.tgz", "create-spark.tgz"]);
    for (const argv of publishes) expect(argv.slice(-2)).toEqual(["--tag", state.latest ? "latest" : "next"]);
    // A publish moves only its channel; a resume repairs that channel and no other.
    expect(distTags()).toEqual(state.retry || state.tagError === "E404" ? [[`@legendapp/spark@${version}`, "latest"], [`@legendapp/create-spark@${version}`, "latest"]] : []);
    for (const tags of Object.values(state.tags)) expect(tags).toEqual(state.latest ? { next: "0.0.1-next.2", latest: version } : { next: version, latest: "0.0.1-next.1" });
  }
});
