import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { clearAppState, DriverState, driverIdentity, exactState, preserveDefaults, sparkNamespace, statePaths, type AppIdentity, type DefaultsHost, type StateHost } from "../scripts/e2e/app-state.ts";

const BUNDLE_ID = "so.legend.spark.examples.kitchensink";
const KITCHEN_SINK: AppIdentity = { bundleId: BUNDLE_ID, projectId: "c0bdf12f-0f35-4b71-8363-b83097388d7b", sandboxed: false };
const NS = "spark.desktop.f24fabcdca7ee623a41d0258b883fdc21422e5c283c01f3ece499645ed451090";
const DRIVER = driverIdentity(KITCHEN_SINK), DRIVER_NS = sparkNamespace(DRIVER.projectId);
const ASN = 'ASN:0x0-0x1-"KitchenSink":';

const cleanup: string[] = [];
afterEach(() => { for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A host whose home, temporary, cache and session roots directories are scratch directories. `running` answers from `processes`. */
function host(overrides: Partial<StateHost> = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "e2e-app-state-"));
  cleanup.push(base);
  const calls: string[] = [];
  const processes: Record<string, string[]> = {};
  const value: StateHost = {
    home: path.join(base, "home"), temp: path.join(base, "T"), cache: path.join(base, "C"), roots: path.join(base, "roots"),
    running: bundleId => { calls.push(`running ${bundleId}`); return processes[bundleId] ?? []; },
    deleteDefaults: domain => { calls.push(`defaults delete ${domain}`); return true; },
    unregister: app => { calls.push(`unregister ${app}`); },
    ...overrides,
  };
  for (const dir of [value.temp, value.roots]) mkdirSync(dir, { recursive: true });
  return { host: value, calls, base, processes };
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
      `/Users/a/Library/Saved Application State/${BUNDLE_ID}.savedState`, `/Users/a/Library/Logs/${BUNDLE_ID}`,
      `/var/T/${NS}`, `/var/T/${NS}.setup`, `/var/T/${NS}.lock`, `/var/T/${NS}.sock`,
      `/var/T/legend-codex-workspace/codex-home-${BUNDLE_ID}`,
    ]);
  });
  test("the clone's identity is never the app's", () => {
    expect(DRIVER).toEqual({ bundleId: `${BUNDLE_ID}.driver`, projectId: `${KITCHEN_SINK.projectId}.driver`, sandboxed: false });
    expect(DRIVER_NS).not.toBe(NS);
  });
});

describe("exact sessions (the release gate)", () => {
  test("clearState deletes the app's defaults domain and every state path that exists, leaving neighbours and link targets alone", () => {
    const { host: fake, calls, base } = host();
    const lib = path.join(fake.home, "Library");
    touch(path.join(lib, "Application Support", NS, "settings", "infra-launch-state.json"));
    touch(path.join(lib, "Saved Application State", `${BUNDLE_ID}.savedState`, "windows.plist"));
    touch(path.join(fake.temp, `${NS}.lock`));
    const outside = path.join(base, "outside");
    touch(path.join(outside, "keep.txt"));
    mkdirSync(path.join(lib, "Caches"), { recursive: true });
    symlinkSync(outside, path.join(lib, "Caches", BUNDLE_ID));
    const neighbours = [path.join(lib, "Application Support", `${BUNDLE_ID}.other`), path.join(lib, "Caches", "com.example.app"), path.join(fake.temp, `${NS}-other`)];
    neighbours.forEach(file => touch(file));

    expect(exactState("/apps/KitchenSink.app", KITCHEN_SINK, BUNDLE_ID, fake).clear()).toEqual([
      `defaults:${BUNDLE_ID}`, path.join(lib, "Application Support", NS), path.join(lib, "Caches", BUNDLE_ID),
      path.join(lib, "Saved Application State", `${BUNDLE_ID}.savedState`), path.join(fake.temp, `${NS}.lock`),
    ]);
    expect(calls).toEqual([`running ${BUNDLE_ID}`, `running ${BUNDLE_ID}`, `defaults delete ${BUNDLE_ID}`]);
    expect(statePaths(KITCHEN_SINK, fake).filter(file => existsSync(file))).toEqual([]);
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("state");
    expect(neighbours.filter(file => existsSync(file))).toEqual(neighbours);
  });

  test("launches the app itself with no state environment, and refuses while any process of the app runs", () => {
    const { host: fake, processes } = host();
    const state = exactState("/apps/KitchenSink.app", KITCHEN_SINK, BUNDLE_ID, fake);
    expect([state.app, state.identity, state.env]).toEqual(["/apps/KitchenSink.app", KITCHEN_SINK, {}]);
    processes[BUNDLE_ID] = [ASN];
    expect(() => exactState("/apps/KitchenSink.app", KITCHEN_SINK, BUNDLE_ID, fake))
      .toThrow(`the exact app /apps/KitchenSink.app runs with ${BUNDLE_ID}'s own state, which another process of it uses; quit it first: ${ASN}`);
    expect(() => state.clear()).toThrow(`clearState needs ${BUNDLE_ID} to be quit first; running: ${ASN}`);
  });

  test.each([
    [{ bundleId: "" }, BUNDLE_ID, 'clearState refuses bundle identifier "": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "com.apple.finder" }, "com.apple.finder", 'clearState refuses bundle identifier "com.apple.finder": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "so.legend/../x.y" }, "so.legend/../x.y", 'clearState refuses bundle identifier "so.legend/../x.y": not an app\'s reverse-DNS identifier'],
    [{ bundleId: "com.example.other" }, BUNDLE_ID, `clearState refuses com.example.other: only the gate manifest's app ${BUNDLE_ID} may be cleared`],
    [{ projectId: " " }, BUNDLE_ID, `clearState refuses ${BUNDLE_ID}: its Spark project identifier is empty`],
    [{ sandboxed: true }, BUNDLE_ID, `clearState does not support sandboxed apps: ${BUNDLE_ID} keeps its state in ~/Library/Containers/${BUNDLE_ID}`],
  ])("clearState refuses %o (expected %s) before touching anything", (identity, expected, message) => {
    const { host: fake, calls } = host();
    expect(() => clearAppState({ ...KITCHEN_SINK, ...identity }, expected, fake)).toThrow(message);
    expect(calls).toEqual([]);
  });

  test("clearState refuses relative, empty or root directories", () => {
    const { host: fake } = host();
    for (const roots of [{ home: "" }, { temp: "relative" }, { cache: "/" }]) {
      expect(() => clearAppState(KITCHEN_SINK, BUNDLE_ID, { ...fake, ...roots, deleteDefaults: () => { throw new Error("must not run"); } })).toThrow(/is not an absolute, non-root path/);
    }
  });
});

describe.skipIf(process.platform !== "darwin")("isolated sessions (DriverState)", () => {
  const plist = (app: string, key: string) => execFileSync("plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  /** A signed app bundle, with `entitlements` when given. */
  function bundle(entitlements?: Record<string, unknown>) {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-app-state-app-")), app = path.join(dir, "Fake.app");
    cleanup.push(dir);
    mkdirSync(path.join(app, "Contents/MacOS"), { recursive: true });
    // Entitlements live in a Mach-O signature; a script cannot carry them.
    if (entitlements) copyFileSync("/usr/bin/true", path.join(app, "Contents/MacOS/Fake"));
    else writeFileSync(path.join(app, "Contents/MacOS/Fake"), "#!/bin/sh\n", { mode: 0o755 });
    const info = path.join(app, "Contents/Info.plist");
    execFileSync("plutil", ["-create", "xml1", info]);
    execFileSync("plutil", ["-insert", "CFBundleIdentifier", "-string", BUNDLE_ID, info]);
    execFileSync("plutil", ["-insert", "CFBundleExecutable", "-string", "Fake", info]);
    const sign = ["-s", "-"];
    if (entitlements) {
      const file = path.join(dir, "entitlements.plist");
      writeFileSync(file, JSON.stringify(entitlements));
      execFileSync("plutil", ["-convert", "xml1", file]);
      sign.push("--entitlements", file);
    }
    execFileSync("codesign", ["--force", ...sign, app], { stdio: "ignore" });
    return app;
  }
  /** A session, disposed after the test. */
  const sessions: DriverState[] = [];
  afterEach(async () => { for (const state of sessions.splice(0)) await state.dispose(0).catch(() => {}); });
  const create = (app: string, fake: StateHost, identity = KITCHEN_SINK) => {
    const state = DriverState.create(app, identity, fake);
    sessions.push(state);
    return state;
  };

  test("clones the app with the driver identity, signed and unquarantined, its home and temporary directories in the session", () => {
    const { host: fake, calls } = host();
    const app = bundle();
    execFileSync("xattr", ["-w", "com.apple.quarantine", "0081;00000000;test;", path.join(app, "Contents/Info.plist")]);
    const state = create(app, fake);
    expect(path.dirname(state.app)).toBe(state.root);
    expect(path.dirname(state.root)).toBe(fake.roots);
    expect(path.basename(state.root)).toMatch(new RegExp(`^spark-driver-state-${DRIVER.bundleId}-`));
    expect(state.identity).toEqual(DRIVER);
    expect(state.env).toEqual({ CFFIXED_USER_HOME: path.join(state.root, "home"), DIRHELPER_USER_DIR_SUFFIX: DRIVER.bundleId });
    expect([plist(state.app, "CFBundleIdentifier"), plist(state.app, "SparkProjectIdentifier")]).toEqual([DRIVER.bundleId, DRIVER.projectId]);
    expect([plist(app, "CFBundleIdentifier"), plist(app, "CFBundleExecutable")]).toEqual([BUNDLE_ID, "Fake"]);
    execFileSync("codesign", ["--verify", "--strict", state.app]);
    expect(execFileSync("xattr", [path.join(state.app, "Contents/Info.plist")], { encoding: "utf8" })).not.toContain("com.apple.quarantine");
    expect(existsSync(state.home)).toBe(true);
    expect(calls).toEqual([`running ${DRIVER.bundleId}`, `defaults delete ${DRIVER.bundleId}`]);
  });

  test("the clone carries no App Intents metadata or App Shortcuts phrases, so the system never learns its intents", () => {
    const { host: fake } = host();
    const app = bundle();
    const metadata = ["Contents/Resources/Metadata.appintents/extract.actionsdata", "Contents/Resources/Kit/Kit.appintents/version.json", "Contents/Resources/en.lproj/AppShortcuts.strings"];
    for (const file of metadata) touch(path.join(app, file));
    touch(path.join(app, "Contents/Resources/en.lproj/Localizable.strings"));
    const state = create(app, fake);
    for (const file of metadata) expect([existsSync(path.join(app, file)), existsSync(path.join(state.app, file))], file).toEqual([true, false]);
    expect(existsSync(path.join(state.app, "Contents/Resources/en.lproj/Localizable.strings"))).toBe(true);
    execFileSync("codesign", ["--verify", "--strict", state.app]);
  });

  test("starts clean: earlier sessions' roots are unregistered and deleted, and the clone's state outside a root is deleted", () => {
    const { host: fake, calls } = host();
    const stale = mkdtempSync(path.join(fake.roots, `spark-driver-state-${DRIVER.bundleId}-`));
    touch(path.join(stale, "KitchenSink.app", "Contents", "Info.plist"));
    const other = mkdtempSync(path.join(fake.roots, "spark-driver-state-com.example.other.driver-"));
    const escaped = path.join(fake.home, "Library", "Saved Application State", `${DRIVER.bundleId}.savedState`, "data");
    const own = path.join(fake.home, "Library", "Saved Application State", `${BUNDLE_ID}.savedState`, "data");
    [escaped, own].forEach(file => touch(file));
    create(bundle(), fake);
    expect(calls).toContain(`unregister ${path.join(stale, "KitchenSink.app")}`);
    expect([existsSync(stale), existsSync(other), existsSync(escaped), existsSync(own)]).toEqual([false, true, false, true]);
  });

  test("sweeps only its own roots, leaving other identities' roots and undeletable lookalikes alone", () => {
    const { host: fake } = host();
    // Lookalikes: an app whose bundle identifier extends the clone's, a non-mkdtemp name, and an entry that cannot be
    // deleted (like the System Integrity Protection-protected `spark-driver-state-*-dirs` folders a macOS temp dir can hold).
    const others = [`spark-driver-state-${DRIVER.bundleId}-x.driver-abc123`, `spark-driver-state-${DRIVER.bundleId}-keep`, "spark-driver-state-7bGgPj-dirs"]
      .map(name => path.join(fake.roots, name));
    others.forEach(dir => touch(path.join(dir, "data")));
    chmodSync(others[2], 0o500);
    const stale = mkdtempSync(path.join(fake.roots, `spark-driver-state-${DRIVER.bundleId}-`));
    try {
      const state = create(bundle(), fake);
      expect(existsSync(stale)).toBe(false);
      expect(others.filter(dir => existsSync(path.join(dir, "data")))).toEqual(others);
      expect(readdirSync(fake.roots).sort()).toEqual([...others.map(dir => path.basename(dir)), path.basename(state.root)].sort());
    } finally {
      chmodSync(others[2], 0o700);
    }
  });

  test("clearState deletes the session's defaults domain and files, never the clone, the app's own state or link targets", () => {
    const { host: fake, calls, base } = host();
    const state = create(bundle(), fake);
    calls.length = 0;
    const home = state.home;
    touch(path.join(home, "Library", "Application Support", DRIVER_NS, "settings", "infra-launch-state.json"));
    touch(path.join(fake.temp, DRIVER.bundleId, `${DRIVER_NS}.lock`));
    // dirhelper's protected NSItemReplacementDirectory, which nobody but the app can list or delete.
    mkdirSync(path.join(fake.temp, DRIVER.bundleId, "TemporaryItems"));
    touch(path.join(fake.cache, DRIVER.bundleId, DRIVER.bundleId, "Cache.db"));
    const outside = path.join(base, "outside");
    touch(path.join(outside, "keep.txt"));
    mkdirSync(path.join(home, "Library", "Caches"), { recursive: true });
    symlinkSync(outside, path.join(home, "Library", "Caches", DRIVER.bundleId));
    // The clone and the app's own state (a developer's running instance).
    const kept = [path.join(state.app, "Contents", "Info.plist"), ...statePaths(KITCHEN_SINK, fake)];
    kept.forEach(file => touch(file));

    expect(state.clear()).toEqual([
      `defaults:${DRIVER.bundleId}`,
      path.join(home, "Library", "Application Support", DRIVER_NS), path.join(home, "Library", "Caches", DRIVER.bundleId),
      path.join(fake.temp, DRIVER.bundleId, `${DRIVER_NS}.lock`), path.join(fake.cache, DRIVER.bundleId, DRIVER.bundleId),
    ]);
    expect(calls).toEqual([`running ${DRIVER.bundleId}`, `defaults delete ${DRIVER.bundleId}`]);
    expect([readdirSync(home), readdirSync(path.join(fake.temp, DRIVER.bundleId))]).toEqual([[], ["TemporaryItems"]]);
    expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("state");
    expect(kept.filter(file => existsSync(file))).toEqual(kept);
  });

  test("clearState refuses while the clone runs, and names state the clone kept outside the session", () => {
    const { host: fake, processes } = host();
    const state = create(bundle(), fake);
    const file = path.join(state.home, "Library", "Application Support", DRIVER_NS, "a.json");
    touch(file);
    processes[DRIVER.bundleId] = [ASN];
    expect(() => state.clear()).toThrow(`clearState needs ${DRIVER.bundleId} to be quit first; running: ${ASN}`);
    delete processes[DRIVER.bundleId];
    const escaped = [path.join(fake.home, "Library", "Saved Application State", `${DRIVER.bundleId}.savedState`), path.join(fake.temp, DRIVER_NS)];
    escaped.forEach(dir => touch(path.join(dir, "data")));
    expect(() => state.clear()).toThrow(`clearState refuses: ${DRIVER.bundleId} kept state outside its driver state root, which it cannot isolate: ${escaped.join(", ")}`);
    expect(existsSync(file)).toBe(true);
  });

  test("never empties a session directory that is a symbolic link", () => {
    const { host: fake, base } = host();
    const state = create(bundle(), fake);
    const target = path.join(base, "elsewhere");
    touch(path.join(target, "keep.txt"));
    rmSync(path.join(fake.temp, DRIVER.bundleId), { recursive: true, force: true });
    symlinkSync(target, path.join(fake.temp, DRIVER.bundleId));
    expect(() => state.clear()).toThrow(`driver state refuses to empty ${path.join(fake.temp, DRIVER.bundleId)}: not a directory owned by this user`);
    expect(existsSync(path.join(target, "keep.txt"))).toBe(true);
    rmSync(path.join(fake.temp, DRIVER.bundleId));
  });

  test("one session per clone identity: a live session's lock refuses, a dead one's is taken over", () => {
    const { host: fake } = host();
    const app = bundle();
    const first = create(app, fake);
    const lock = path.join(fake.temp, `spark-driver-${DRIVER.bundleId}.lock`);
    expect(readFileSync(path.join(lock, "pid"), "utf8")).toBe(String(process.pid));
    expect(() => DriverState.create(app, KITCHEN_SINK, fake)).toThrow(`another driver session (pid ${process.pid}) runs ${DRIVER.bundleId}; ${lock} is its lock`);
    expect(existsSync(first.root)).toBe(true);
    writeFileSync(path.join(lock, "pid"), "2147483646");
    create(app, fake);
    expect(existsSync(first.root)).toBe(false);
  });

  test("refuses a running clone, a sandboxed app, a bad identifier and entitlements an ad hoc copy cannot carry, leaving nothing behind", () => {
    const { host: fake, processes } = host();
    const app = bundle();
    const roots = () => readdirSync(fake.roots).length;
    processes[DRIVER.bundleId] = [ASN];
    expect(() => DriverState.create(app, KITCHEN_SINK, fake)).toThrow(`another driver session runs ${DRIVER.bundleId}: ${ASN}`);
    delete processes[DRIVER.bundleId];
    expect(() => DriverState.create(app, { ...KITCHEN_SINK, sandboxed: true }, fake))
      .toThrow(`driver launches do not support sandboxed apps: ${BUNDLE_ID} keeps its state in its container, ~/Library/Containers/${BUNDLE_ID}`);
    expect(() => DriverState.create(app, { ...KITCHEN_SINK, bundleId: "com.apple.finder" }, fake)).toThrow('a driver launch refuses bundle identifier "com.apple.finder"');
    expect(() => DriverState.create(bundle({ "keychain-access-groups": ["ABCDE12345.so.legend"], "com.apple.security.app-sandbox": false }), KITCHEN_SINK, fake))
      .toThrow(/an ad hoc signed copy cannot carry its entitlements keychain-access-groups$/);
    expect(roots()).toBe(0);
    expect(existsSync(path.join(fake.temp, `spark-driver-${DRIVER.bundleId}.lock`))).toBe(false);
  });

  test("dispose waits for the clone to exit, then deletes the domain, the session's files, its registration and the root, and releases the lock", async () => {
    const { host: fake, calls, processes } = host();
    const state = create(bundle(), fake);
    sessions.pop();
    touch(path.join(fake.temp, DRIVER.bundleId, "x"));
    touch(path.join(fake.cache, DRIVER.bundleId, "x"));
    processes[DRIVER.bundleId] = [ASN];
    setTimeout(() => { delete processes[DRIVER.bundleId]; }, 250);
    calls.length = 0;
    await state.dispose();
    expect(calls.filter(call => !call.startsWith("running"))).toEqual([`defaults delete ${DRIVER.bundleId}`, `unregister ${state.app}`]);
    expect(existsSync(state.root)).toBe(false);
    // macOS protects the directories themselves (System Integrity Protection), so they stay, empty.
    expect([fake.temp, fake.cache].map(dir => readdirSync(path.join(dir, DRIVER.bundleId)))).toEqual([[], []]);
    expect(existsSync(path.join(fake.temp, `spark-driver-${DRIVER.bundleId}.lock`))).toBe(false);
  });

  test("dispose keeps the state of a clone that does not exit", async () => {
    const { host: fake, processes } = host();
    const state = create(bundle(), fake);
    processes[DRIVER.bundleId] = [ASN];
    await expect(state.dispose(200)).rejects.toThrow(`the driven clone ${DRIVER.bundleId} still runs 0.2 s after its session ended, so its state in ${state.root} is kept: ${ASN}`);
    expect(existsSync(state.app)).toBe(true);
    delete processes[DRIVER.bundleId];
    cleanup.push(state.root);
  });
});

describe("preserveDefaults", () => {
  const APP = "so.legend.spark.examples.kitchensink";
  function host(values: Record<string, string>, running: string[] = []) {
    const calls: string[] = [];
    const fake: DefaultsHost = {
      running: id => { calls.push(`running ${id}`); return running; },
      read: (domain, key) => values[`${domain} ${key}`],
      write: (domain, key, value) => { calls.push(`write ${domain} ${key} ${value}`); },
      remove: (domain, key) => { calls.push(`remove ${domain} ${key}`); },
    };
    return { fake, calls };
  }

  test("the restore writes previous values back and deletes keys that were absent", () => {
    const { fake, calls } = host({ [`${APP} AppleLanguages`]: "<array><string>fr</string></array>" });
    const restore = preserveDefaults(APP, ["AppleLanguages", "AppleLocale"], APP, fake);
    expect(calls).toEqual([`running ${APP}`]);
    restore();
    expect(calls.slice(1)).toEqual([`write ${APP} AppleLanguages <array><string>fr</string></array>`, `remove ${APP} AppleLocale`]);
  });

  test("an isolated session's .driver domain composes; other domains and a running app are refused before any read", () => {
    const { fake, calls } = host({});
    preserveDefaults(`${APP}.driver`, ["AppleLanguages"], APP, fake)();
    expect(calls).toEqual([`running ${APP}.driver`, `remove ${APP}.driver AppleLanguages`]);
    expect(() => preserveDefaults("com.example.other", ["AppleLanguages"], APP, fake)).toThrow("only the flow's app");
    expect(() => preserveDefaults("com.apple.finder", ["AppleLanguages"], "com.apple.finder", fake)).toThrow("reverse-DNS");
    expect(() => preserveDefaults(APP, [], APP, fake)).toThrow("needs defaults keys");
    expect(() => preserveDefaults(APP, ["a b"], APP, fake)).toThrow("needs defaults keys");
    const busy = host({}, ["ASN:0x0-0x1:"]);
    expect(() => preserveDefaults(APP, ["AppleLanguages"], APP, busy.fake)).toThrow(`needs ${APP} to be quit first`);
    expect(busy.calls).toEqual([`running ${APP}`]);
  });
});
