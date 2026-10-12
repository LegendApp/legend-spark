import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";

const state = vi.hoisted(() => ({
  release: {} as any, commands: [] as string[][], checks: new Map<string, number>(),
  failCreate: false, visible: true, retry: false,
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
    expect(state.tags[name]!.next).toBe(version);
    if (latest) expect(state.tags[name]!.latest).toBe(version);
  },
}));
vi.mock("../packages/cli/src/process.ts", () => ({ spawnProcess: (argv: string[]) => {
  state.commands.push(argv);
  const code = state.failCreate && argv[1] === "publish" && path.basename(argv[2]!) === "create-spark.tgz" ? 1 : 0;
  if (argv[1] === "publish" && !code) {
    const name = path.basename(argv[2]!) === "spark.tgz" ? "@legendapp/spark" : "@legendapp/create-spark";
    // npm publish implicitly moves its chosen dist-tag, even before promotion.
    state.tags[name]![argv[argv.indexOf("--tag") + 1]!] = state.release.version;
  }
  if (argv[1] === "dist-tag") {
    for (const name of Object.keys(state.tags)) expect(state.checks.get(name)).toBe(2);
    if (argv[2] === "rm") delete state.tags[argv[3]!]![argv[4]!];
    else {
      const name = argv[3]!.slice(0, argv[3]!.lastIndexOf("@"));
      state.tags[name]![argv[4]!] = state.release.version;
    }
  }
  return { exited: Promise.resolve(code) };
} }));
vi.mock("../packages/cli/src/commands.ts", () => ({ run: async (_root: string, argv: string[]) => {
  if (argv[0] === "git") return argv[1] === "rev-parse" ? state.release.revision : "";
  if (argv.includes("visibility")) return '{"visibility":"PUBLIC"}';
  if (argv[1] === "api" && argv[2]?.includes("git/ref")) return JSON.stringify({ object: { type: "commit", sha: state.release.revision } });
  if (argv[1] === "api") return JSON.stringify([[{ tag_name: `v${state.release.version}`, draft: false,
    assets: Object.entries(state.release.sha256).map(([name, hash]) => ({ name, digest: `sha256:${hash}` })) }]]);
  if (argv.includes("dist-tags")) return JSON.stringify(state.tags[argv[2]!]);
  if (argv[1] === "release") return '{"isDraft":false}';
  return "";
} }));

afterEach(() => { vi.restoreAllMocks(); });

test.each(["success", "create failure", "not visible", "retry"])("release publication gates promotions: %s", async scenario => {
  vi.resetModules();
  state.commands = [];
  state.checks.clear();
  state.failCreate = scenario === "create failure";
  state.visible = scenario !== "not visible";
  state.retry = scenario === "retry";
  state.tags = {
    "@legendapp/spark": { next: "0.0.1-next.2", latest: "0.0.1-next.1" },
    "@legendapp/create-spark": { next: "0.0.1-next.2", latest: "0.0.1-next.1" },
  };
  const hash = createHash("sha256").update("archive bytes").digest("hex");
  state.release = { version: "0.0.1-next.3", revision: "a".repeat(40), npm: "spark.tgz", createNpm: "create-spark.tgz",
    sha256: { "spark.tgz": hash, "create-spark.tgz": hash, "runner-manifest.json": hash } };
  vi.spyOn(process, "argv", "get").mockReturnValue([process.execPath, "publish-release.ts", "--latest"]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const publication = import("../scripts/publish-release.ts");
  if (state.failCreate || !state.visible) {
    await expect(publication).rejects.toThrow(state.failCreate ? "npm publish @legendapp/create-spark exited 1" : "not visible yet");
    expect(state.commands.some(argv => argv[1] === "dist-tag")).toBe(false);
    for (const tags of Object.values(state.tags)) {
      expect(tags.next).toBe("0.0.1-next.2");
      expect(tags.latest).toBe("0.0.1-next.1");
    }
  } else {
    await publication;
    const publishes = state.commands.filter(argv => argv[1] === "publish");
    expect(publishes.map(argv => path.basename(argv[2]!))).toEqual(state.retry ? [] : ["spark.tgz", "create-spark.tgz"]);
    for (const argv of publishes) expect(argv.slice(-2)).toEqual(["--tag", "staging"]);
    const firstPromotion = state.commands.findIndex(argv => argv[1] === "dist-tag");
    expect(state.commands.slice(firstPromotion).every(argv => argv[1] === "dist-tag")).toBe(true);
    expect(state.commands.filter(argv => argv[1] === "dist-tag").map(argv => argv.slice(3))).toEqual([
      ["@legendapp/spark@0.0.1-next.3", "next"], ["@legendapp/spark@0.0.1-next.3", "latest"],
      ["@legendapp/create-spark@0.0.1-next.3", "next"], ["@legendapp/create-spark@0.0.1-next.3", "latest"],
      ["@legendapp/spark", "staging"], ["@legendapp/create-spark", "staging"],
    ]);
    for (const tags of Object.values(state.tags)) expect(tags.staging).toBeUndefined();
  }
});
