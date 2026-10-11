import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { clearAppState, sparkNamespace, statePaths, type AppIdentity, type StateHost } from "../scripts/e2e/app-state.ts";

const BUNDLE_ID = "so.legend.spark.examples.kitchensink";
const KITCHEN_SINK: AppIdentity = { bundleId: BUNDLE_ID, projectId: "c0bdf12f-0f35-4b71-8363-b83097388d7b", sandboxed: false };
const NS = "spark.desktop.f24fabcdca7ee623a41d0258b883fdc21422e5c283c01f3ece499645ed451090";

function host(overrides: Partial<StateHost> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "e2e-app-state-"));
  const calls: string[] = [];
  const value: StateHost = {
    home: path.join(root, "home"), temp: path.join(root, "T"),
    running: bundleId => { calls.push(`running ${bundleId}`); return []; },
    deleteDefaults: domain => { calls.push(`defaults delete ${domain}`); return true; },
    ...overrides,
  };
  return { host: value, calls, root };
}
const touch = (file: string, text = "state") => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };

describe("statePaths", () => {
  test("names the Spark namespace and bundle identifier locations, nothing else", () => {
    expect(sparkNamespace(KITCHEN_SINK.projectId)).toBe(NS);
    expect(statePaths(KITCHEN_SINK, { home: "/Users/a", temp: "/var/T" })).toEqual([
      `/Users/a/Library/Application Support/${NS}`, `/Users/a/Library/Application Support/${BUNDLE_ID}`,
      `/Users/a/Library/Caches/${NS}`, `/Users/a/Library/Caches/${BUNDLE_ID}`,
      `/Users/a/Library/HTTPStorages/${BUNDLE_ID}`, `/Users/a/Library/HTTPStorages/${BUNDLE_ID}.binarycookies`,
      `/Users/a/Library/Cookies/${BUNDLE_ID}.binarycookies`, `/Users/a/Library/WebKit/${BUNDLE_ID}`,
      `/Users/a/Library/Saved Application State/${BUNDLE_ID}.savedState`,
      `/var/T/${NS}`, `/var/T/${NS}.setup`, `/var/T/${NS}.lock`, `/var/T/${NS}.sock`,
      `/var/T/legend-codex-workspace/codex-home-${BUNDLE_ID}`,
    ]);
  });
});

describe("clearAppState", () => {
  test("deletes the defaults domain and every state path that exists, leaving neighbours and link targets alone", () => {
    const { host: fake, calls, root } = host();
    const lib = path.join(fake.home, "Library");
    touch(path.join(lib, "Application Support", NS, "settings", "infra-launch-state.json"));
    touch(path.join(lib, "Saved Application State", `${BUNDLE_ID}.savedState`, "windows.plist"));
    touch(path.join(fake.temp, `${NS}.lock`));
    const outside = path.join(root, "outside");
    touch(path.join(outside, "keep.txt"));
    mkdirSync(path.join(lib, "Caches"), { recursive: true });
    symlinkSync(outside, path.join(lib, "Caches", BUNDLE_ID));
    const neighbours = [path.join(lib, "Application Support", `${BUNDLE_ID}.other`), path.join(lib, "Caches", "com.example.app"), path.join(fake.temp, `${NS}-other`)];
    neighbours.forEach(file => touch(file));

    expect(clearAppState(KITCHEN_SINK, BUNDLE_ID, fake)).toEqual([
      `defaults:${BUNDLE_ID}`, path.join(lib, "Application Support", NS), path.join(lib, "Caches", BUNDLE_ID),
      path.join(lib, "Saved Application State", `${BUNDLE_ID}.savedState`), path.join(fake.temp, `${NS}.lock`),
    ]);
    expect(calls).toEqual([`running ${BUNDLE_ID}`, `defaults delete ${BUNDLE_ID}`]);
    expect(statePaths(KITCHEN_SINK, fake).filter(file => existsSync(file))).toEqual([]);
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("state");
    expect(neighbours.filter(file => existsSync(file))).toEqual(neighbours);
  });

  test("a missing defaults domain and missing paths clear nothing", () => {
    const { host: fake } = host({ deleteDefaults: () => false });
    expect(clearAppState(KITCHEN_SINK, BUNDLE_ID, fake)).toEqual([]);
  });

  test.each([
    [{ bundleId: "" }, BUNDLE_ID, 'clearState refuses bundle identifier "": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "kitchensink" }, "kitchensink", 'clearState refuses bundle identifier "kitchensink": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "com.apple.finder" }, "com.apple.finder", 'clearState refuses bundle identifier "com.apple.finder": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "so.legend/../x.y" }, "so.legend/../x.y", 'clearState refuses bundle identifier "so.legend/../x.y": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "com.example.other" }, BUNDLE_ID, `clearState refuses com.example.other: only the gate manifest's app ${BUNDLE_ID} may be cleared`],
    [{ projectId: " " }, BUNDLE_ID, `clearState refuses ${BUNDLE_ID}: its Spark project identifier is empty`],
    [{ sandboxed: true }, BUNDLE_ID, `clearState does not support sandboxed apps: ${BUNDLE_ID} keeps its state in ~/Library/Containers/${BUNDLE_ID}`],
  ])("refuses %o (expected %s) before touching anything", (identity, expected, message) => {
    const { host: fake, calls } = host();
    expect(() => clearAppState({ ...KITCHEN_SINK, ...identity }, expected, fake)).toThrow(message);
    expect(calls).toEqual([]);
  });

  test("refuses while the app runs", () => {
    const { host: fake, calls } = host({ running: () => ['ASN:0x0-0x1-"KitchenSink":'] });
    touch(path.join(fake.home, "Library", "Application Support", NS, "settings", "a.json"));
    expect(() => clearAppState(KITCHEN_SINK, BUNDLE_ID, fake)).toThrow(`clearState needs ${BUNDLE_ID} to be quit first; running: ASN:0x0-0x1-"KitchenSink":`);
    expect(calls).toEqual([]);
    expect(existsSync(path.join(fake.home, "Library", "Application Support", NS))).toBe(true);
  });
});
