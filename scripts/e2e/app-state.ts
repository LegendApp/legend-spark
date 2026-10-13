// The app state of driver launches (docs/e2e-flows.md#app-state). An `isolated` session (the default) launches an APFS
// clone of the app with its own bundle and project identifiers, so its defaults domain, Keychain service and Spark
// namespace are never the app's, and points the app's home and temporary directories at a per-session root. `exact`
// (the release gate) launches the app itself with its real state. `launchApp: { clearState: true }` deletes the
// session's state.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** `bundleId` is CFBundleIdentifier; `projectId` is SparkProjectIdentifier, which the host falls back to the bundle id for. */
export type AppIdentity = { bundleId: string; projectId: string; sandboxed: boolean };
export type StateHost = {
  /** The user's home, and the per-user temporary and cache directories (`getconf DARWIN_USER_TEMP_DIR`, `DARWIN_USER_CACHE_DIR`). */
  home: string;
  temp: string;
  cache: string;
  /** The directory that holds isolated sessions' roots: os.tmpdir(). */
  roots: string;
  /** Running processes of the app, by bundle identifier. */
  running(bundleId: string): string[];
  /** `defaults delete <domain>` when the domain holds a key; false when it holds none. */
  deleteDefaults(domain: string): boolean;
  /** Removes an app bundle's LaunchServices registration, if any (`lsregister -u`), so a deleted copy claims no URL scheme. */
  unregister(app: string): void;
};
/** `isolated`: a clone with its own identity and state (e2e:run, ks:capture). `exact`: the app itself and its real state (the release gate). */
export type StateMode = "isolated" | "exact";
/** What a driver session launches (`app`, as `identity`, with `env`) and how its state is deleted. */
export type AppState = {
  readonly app: string;
  readonly identity: AppIdentity;
  readonly env: Readonly<Record<string, string>>;
  clear(): string[];
  dispose(): Promise<void>;
};

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+){2,}$/;
const ROOT_PREFIX = "spark-driver-state-";
const EXIT_TIMEOUT_MS = 10000;
/**
 * Launch environment that moves the app's state: NSHomeDirectory() (and every path under ~/Library that Foundation
 * derives from it), and NSTemporaryDirectory() and the cache directory, which become `<directory>/<suffix>/`.
 */
export const STATE_ENV = ["CFFIXED_USER_HOME", "DIRHELPER_USER_DIR_SUFFIX"] as const;

/** `SparkNamespace()` in packages/desktop-app/macos/SparkDesktop.mm: the per-project prefix of Spark's own storage. */
export const sparkNamespace = (projectId: string) => `spark.desktop.${createHash("sha256").update(projectId).digest("hex")}`;

/** The identity of the driven clone: never the app's own, so no state keyed by it is the app's. */
export const driverIdentity = ({ bundleId, projectId, sandboxed }: AppIdentity): AppIdentity => ({ bundleId: `${bundleId}.driver`, projectId: `${projectId}.driver`, sandboxed });

/** Where an app keeps state under a home and a temporary directory, besides its `defaults` domain. Found in the Spark, React Native and WebView code. */
export function statePaths({ bundleId, projectId }: AppIdentity, { home, temp }: { home: string; temp: string }): string[] {
  const ns = sparkNamespace(projectId), library = path.join(home, "Library");
  return [
    path.join(library, "Application Support", ns), // settings, file-system "data", SQLite
    path.join(library, "Application Support", bundleId), // React Native AsyncStorage
    path.join(library, "Caches", ns), // file-system "cache"
    path.join(library, "Caches", bundleId), // NSURLCache, Sparkle downloads, WebKit caches
    path.join(library, "HTTPStorages", bundleId), // NSURLSession cookies and HSTS
    path.join(library, "HTTPStorages", `${bundleId}.binarycookies`),
    path.join(library, "Cookies", `${bundleId}.binarycookies`),
    path.join(library, "WebKit", bundleId), // WKWebsiteDataStore.defaultDataStore
    path.join(library, "Saved Application State", `${bundleId}.savedState`), // AppKit window restoration
    path.join(library, "Logs", bundleId), // @legendapp/spark/logging files
    path.join(temp, ns), // file-system "temp"
    ...[".setup", ".lock", ".sock"].map(suffix => path.join(temp, `${ns}${suffix}`)), // the single-instance lock
    path.join(temp, "legend-codex-workspace", `codex-home-${bundleId}`), // the codex package's CODEX_HOME
  ];
}

function checkIdentity({ bundleId, projectId }: AppIdentity, action: string) {
  if (!BUNDLE_ID.test(bundleId) || bundleId.startsWith("com.apple.")) throw new Error(`${action} refuses bundle identifier "${bundleId}": not an app's reverse-DNS identifier`);
  if (!projectId.trim()) throw new Error(`${action} refuses ${bundleId}: its Spark project identifier is empty`);
}
function checkRoots(host: Pick<StateHost, "home" | "temp" | "cache" | "roots">, action: string) {
  // Every path is joined onto these roots; a relative or empty root would delete relative to the working directory.
  for (const [name, root] of [["home", host.home], ["temp", host.temp], ["cache", host.cache], ["roots", host.roots]] as const) {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) throw new Error(`${action} refuses: the ${name} directory "${root}" is not an absolute, non-root path`);
  }
}
/** Deletes what exists of `files` (a symbolic link is removed itself, never followed); returns it. */
function remove(files: string[]): string[] {
  return files.filter(file => {
    if (!lstatSync(file, { throwIfNoEntry: false })) return false;
    rmSync(file, { recursive: true });
    return true;
  });
}

/**
 * Deletes the app's own persisted state (`exact` sessions) and returns what existed: the `defaults` domain (as
 * `defaults:<bundle id>`) and the paths of `statePaths`. Refuses an identifier that is not `expected` (the gate
 * manifest's appId) or not a reverse-DNS app identifier, a sandboxed app, and an app that is running.
 */
export function clearAppState(identity: AppIdentity, expected: string, host: StateHost = macHost()): string[] {
  const { bundleId } = identity;
  checkIdentity(identity, "clearState");
  if (bundleId !== expected) throw new Error(`clearState refuses ${bundleId}: only the gate manifest's app ${expected} may be cleared`);
  // Removing another app's container needs the "access data from other apps" permission, which would prompt.
  if (identity.sandboxed) throw new Error(`clearState does not support sandboxed apps: ${bundleId} keeps its state in ~/Library/Containers/${bundleId}`);
  // cfprefsd and the app's open files would write the state back.
  const running = host.running(bundleId);
  if (running.length) throw new Error(`clearState needs ${bundleId} to be quit first; running: ${running.join(", ")}`);
  checkRoots(host, "clearState");
  return [...host.deleteDefaults(bundleId) ? [`defaults:${bundleId}`] : [], ...remove(statePaths(identity, host))];
}

/**
 * An `exact` session: the app itself, with its real state, for the release gate. A driven app skips the single-instance
 * lock and would share that state with another instance, so it refuses while any process of the app runs.
 */
export function exactState(app: string, identity: AppIdentity, expected: string, host: StateHost = macHost()): AppState {
  const running = host.running(identity.bundleId);
  if (running.length) throw new Error(`the exact app ${app} runs with ${identity.bundleId}'s own state, which another process of it uses; quit it first: ${running.join(", ")}`);
  return { app, identity, env: {}, clear: () => clearAppState(identity, expected, host), dispose: async () => {} };
}

/**
 * Entitlements an ad hoc signature cannot carry: they need a provisioning profile or a team identifier, so the clone
 * would not launch, or would reach the app's own Keychain items and app group containers.
 */
function restrictedEntitlements(app: string): string[] {
  const xml = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!xml.trim()) return [];
  const entitlements = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: xml, encoding: "utf8" })) as Record<string, unknown>;
  return Object.entries(entitlements).filter(([key, value]) =>
    key === "keychain-access-groups" || key === "com.apple.application-identifier" || key.startsWith("com.apple.developer.")
    || (key === "com.apple.security.application-groups" && Array.isArray(value) && value.some(group => /^[A-Z0-9]{10}\./.test(String(group))))).map(([key]) => key);
}

/** One isolated session per clone identity at a time, across processes: a directory holding the owner's pid. */
function acquireLock(dir: string, bundleId: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(path.join(dir, "pid"), String(process.pid));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt) throw error;
    }
    const pid = Number(readFileSync(path.join(dir, "pid"), "utf8").trim() || NaN);
    if (alive(pid)) throw new Error(`another driver session (pid ${pid}) runs ${bundleId}; ${dir} is its lock`);
    rmSync(dir, { recursive: true, force: true });
  }
}
function alive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
/** The name of a session root of the clone `bundleId`: mkdtemp's six characters after the prefix, so another identity's roots never match. */
const rootName = (bundleId: string) => new RegExp(`^${ROOT_PREFIX}${bundleId.replaceAll(".", "\\.")}-[A-Za-z0-9]{6}$`);
/** A session root: a direct child of the host's roots directory, named for the clone's identity. */
function isRoot(root: string, bundleId: string, roots: string) {
  return path.dirname(path.resolve(root)) === path.resolve(roots) && rootName(bundleId).test(path.basename(root));
}

/**
 * An `isolated` session's app: a clone of the app with `driverIdentity`, and its state root. `env` is the launch
 * environment that keeps the clone's files under the root. Created by `create()`; `dispose()` deletes it all.
 */
export class DriverState implements AppState {
  readonly identity: AppIdentity;
  readonly app: string;
  readonly env: Readonly<Record<(typeof STATE_ENV)[number], string>>;
  readonly home: string;
  /** The home, temporary and cache directories, with the depth the clearState log lists. */
  private readonly dirs: Array<[string, number]>;
  private readonly lock: string;

  private constructor(readonly root: string, app: string, identity: AppIdentity, private readonly host: StateHost) {
    this.identity = driverIdentity(identity);
    if (!isRoot(root, this.identity.bundleId, host.roots)) throw new Error(`driver state refuses root ${root}: not ${host.roots}/${ROOT_PREFIX}${this.identity.bundleId}-*`);
    this.app = path.join(root, path.basename(app));
    this.home = path.join(root, "home");
    // dirhelper creates `<directory>/<suffix>` protected by System Integrity Protection: its contents can be deleted, it
    // cannot. So every session of an app shares one, named by the clone's identity, one session at a time (the lock).
    const suffix = this.identity.bundleId;
    this.dirs = [[this.home, 3], [path.join(host.temp, suffix), 1], [path.join(host.cache, suffix), 1]];
    this.env = { CFFIXED_USER_HOME: this.home, DIRHELPER_USER_DIR_SUFFIX: suffix };
    this.lock = lockFor(host, this.identity.bundleId);
  }

  /**
   * Takes the clone identity's session lock, deletes what earlier sessions left (their roots, LaunchServices
   * registrations, defaults domain, and state of the clone's identity outside a root), then creates a 0700 root, clones
   * `app` into it (APFS clonefile) with `driverIdentity`, signs the clone ad hoc keeping its entitlements and flags, and
   * removes its quarantine. Refuses a sandboxed app, entitlements an ad hoc signature cannot carry, and a running clone.
   */
  static create(app: string, identity: AppIdentity, host: StateHost = macHost()): DriverState {
    checkIdentity(identity, "a driver launch");
    if (identity.sandboxed) throw new Error(`driver launches do not support sandboxed apps: ${identity.bundleId} keeps its state in its container, ~/Library/Containers/${identity.bundleId}`);
    checkRoots(host, "a driver launch");
    const restricted = restrictedEntitlements(app);
    if (restricted.length) throw new Error(`driver launches refuse ${app}: an ad hoc signed copy cannot carry its entitlements ${restricted.join(", ")}`);
    const { bundleId } = driverIdentity(identity), lock = lockFor(host, bundleId);
    acquireLock(lock, bundleId);
    let root: string | undefined;
    try {
      const running = host.running(bundleId);
      if (running.length) throw new Error(`another driver session runs ${bundleId}: ${running.join(", ")}`);
      for (const stale of readdirSync(host.roots).filter(name => rootName(bundleId).test(name))) {
        const dir = path.join(host.roots, stale);
        if (lstatSync(dir).isDirectory()) for (const name of readdirSync(dir).filter(name => name.endsWith(".app"))) host.unregister(path.join(dir, name));
        rmSync(dir, { recursive: true, force: true });
      }
      remove(statePaths(driverIdentity(identity), host));
      host.deleteDefaults(bundleId);
      root = mkdtempSync(path.join(host.roots, `${ROOT_PREFIX}${bundleId}-`));
      const state = new DriverState(root, app, identity, host);
      execFileSync("cp", ["-cR", app, state.app]);
      const plist = path.join(state.app, "Contents/Info.plist");
      execFileSync("plutil", ["-replace", "CFBundleIdentifier", "-string", bundleId, plist]);
      execFileSync("plutil", ["-replace", "SparkProjectIdentifier", "-string", state.identity.projectId, plist]);
      // LaunchServices registers the clone when it launches; it must not offer the app's intents to Shortcuts, Spotlight or Siri.
      removeAppIntentsMetadata(state.app);
      execFileSync("codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags", state.app], { stdio: ["ignore", "ignore", "pipe"] });
      execFileSync("xattr", ["-dr", "com.apple.quarantine", state.app]);
      mkdirSync(state.home, { mode: 0o700 });
      state.empty();
      return state;
    } catch (error) {
      if (root) rmSync(root, { recursive: true, force: true });
      rmSync(lock, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Deletes this session's state: the clone's defaults domain and what its home, temporary and cache directories hold.
   * Returns what existed. Refuses while the clone runs, and when state of the clone's identity exists outside the root,
   * which the launch environment did not move.
   */
  clear(): string[] {
    const { bundleId } = this.identity, host = this.host;
    // cfprefsd and the app's open files would write the state back.
    const running = host.running(bundleId);
    if (running.length) throw new Error(`clearState needs ${bundleId} to be quit first; running: ${running.join(", ")}`);
    const escaped = statePaths(this.identity, host).filter(file => lstatSync(file, { throwIfNoEntry: false }));
    if (escaped.length) throw new Error(`clearState refuses: ${bundleId} kept state outside its driver state root, which it cannot isolate: ${escaped.join(", ")}`);
    return [...host.deleteDefaults(bundleId) ? [`defaults:${bundleId}`] : [], ...this.empty()];
  }

  /**
   * Waits for the clone to exit, then deletes its defaults domain, what its temporary and cache directories hold, its
   * LaunchServices registration and the root, and releases the session lock. A clone still running after `timeoutMs`
   * keeps its state (the next session refuses to start until it exits).
   */
  async dispose(timeoutMs = EXIT_TIMEOUT_MS) {
    try {
      const deadline = Date.now() + timeoutMs;
      let running = this.host.running(this.identity.bundleId);
      while (running.length && Date.now() < deadline) {
        await sleep(100);
        running = this.host.running(this.identity.bundleId);
      }
      if (running.length) throw new Error(`the driven clone ${this.identity.bundleId} still runs ${timeoutMs / 1000} s after its session ended, so its state in ${this.root} is kept: ${running.join(", ")}`);
      this.host.deleteDefaults(this.identity.bundleId);
      this.empty();
      this.host.unregister(this.app);
      if (!isRoot(this.root, this.identity.bundleId, this.host.roots)) throw new Error(`driver state refuses to delete ${this.root}`);
      rmSync(this.root, { recursive: true, force: true });
    } finally {
      rmSync(this.lock, { recursive: true, force: true });
    }
  }

  /** Deletes what the home, temporary and cache directories hold; returns it. Each must be a real directory of this user. */
  private empty(): string[] {
    return this.dirs.flatMap(([dir, depth]) => {
      const stat = lstatSync(dir, { throwIfNoEntry: false });
      if (!stat) return [];
      if (!stat.isDirectory() || stat.uid !== process.getuid!()) throw new Error(`driver state refuses to empty ${dir}: not a directory owned by this user`);
      const found = entries(dir, depth).filter(file => !PROTECTED.has(path.basename(file)));
      // A symbolic link inside is removed itself, never followed.
      for (const entry of readdirSync(dir)) if (!PROTECTED.has(entry)) rmSync(path.join(dir, entry), { recursive: true });
      return found;
    });
  }
}

/**
 * Deletes the App Intents metadata in a bundle (its own and its frameworks': `*.appintents`) and the App Shortcuts
 * phrases (`AppShortcuts.strings` in each `.lproj`), so the system finds no intents or App Shortcuts in it. Returns them.
 */
export function removeAppIntentsMetadata(app: string): string[] {
  const found = (readdirSync(app, { recursive: true, encoding: "utf8" }) as string[])
    .filter(file => /\.appintents$/.test(file) || /\.lproj\/AppShortcuts\.strings$/.test(file))
    .map(file => path.join(app, file));
  for (const file of found) rmSync(file, { recursive: true, force: true });
  return found;
}

const lockFor = (host: Pick<StateHost, "temp">, bundleId: string) => path.join(host.temp, `spark-driver-${bundleId}.lock`);

/** What a directory holds, `depth` levels down (`home/Library/Application Support/<namespace>`), for the clearState log. */
/**
 * What dirhelper creates in an app's temporary directory and protects like the directory itself (System Integrity
 * Protection): `TemporaryItems`, for NSItemReplacementDirectory. Nobody but the app can list or delete it, so emptying
 * the directory leaves it.
 */
const PROTECTED = new Set(["TemporaryItems"]);

function entries(dir: string, depth: number): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return depth > 1 && entry.isDirectory() ? entries(file, depth - 1) : [file];
  });
}

const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** Running processes of an app, by bundle identifier (LaunchServices' `lsappinfo`). */
export function runningApps(bundleId: string): string[] {
  const result = spawnSync("lsappinfo", ["find", `bundleid=${bundleId}`], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result.stdout.split("\n").map(line => line.trim()).filter(Boolean);
}

export function macHost(): StateHost {
  const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const result = spawnSync(command, args, { encoding: "utf8", env });
    if (result.error) throw result.error;
    return result;
  };
  // This process's own directories, never a suffixed one it may have inherited.
  const { DIRHELPER_USER_DIR_SUFFIX: _suffix, ...env } = process.env;
  return {
    home: os.homedir(),
    temp: run("getconf", ["DARWIN_USER_TEMP_DIR"], env).stdout.trim(),
    cache: run("getconf", ["DARWIN_USER_CACHE_DIR"], env).stdout.trim(),
    roots: os.tmpdir(),
    running: runningApps,
    deleteDefaults(domain) {
      // `defaults export` prints the domain as an XML property list (an empty dictionary when it has no keys) on every
      // macOS release; the messages of `defaults read` and `defaults delete` for a missing domain differ between releases.
      const exported = run("defaults", ["export", domain, "-"]);
      if (exported.status !== 0) throw new Error(`defaults export ${domain} failed (${exported.status}): ${exported.stderr.trim()}`);
      if (/<plist[^>]*>\s*<dict\/>\s*<\/plist>/.test(exported.stdout)) return false;
      const result = run("defaults", ["delete", domain]);
      if (result.status !== 0) throw new Error(`defaults delete ${domain} failed (${result.status}): ${result.stderr.trim()}`);
      return true;
    },
    unregister(app) {
      const result = run(LSREGISTER, ["-u", app]);
      // -10814 (kLSApplicationNotFoundErr): LaunchServices never registered it (it never ran through LaunchServices).
      if (result.status !== 0 && !/: -10814\b/.test(result.stderr)) throw new Error(`lsregister -u ${app} failed (${result.status}): ${result.stderr.trim()}`);
    },
  };
}

/** The `defaults` operations `preserveDefaults` needs; values are XML property lists. */
export type DefaultsHost = {
  running(bundleId: string): string[];
  /** The key's value, or undefined when the domain does not hold it. */
  read(domain: string, key: string): string | undefined;
  write(domain: string, key: string, value: string): void;
  /** Deletes the key; a key that is already absent is not an error. */
  remove(domain: string, key: string): void;
};

/**
 * `preserveAppDefaults` (docs/e2e-flows.md#preserveappdefaults): reads `keys` of the app's `defaults` domain and returns a
 * restore that writes each previous value back, or deletes a key that was absent. `domain` is the bundle identifier the
 * flow's app really runs under. Refuses while a process with that identifier runs, so the snapshot is what the next
 * launch would read, and so a flow never changes the defaults of an app someone is using.
 */
export function preserveDefaults(domain: string, keys: readonly string[], expected: string, host: DefaultsHost = macDefaultsHost()): () => void {
  if (!BUNDLE_ID.test(domain) || domain.startsWith("com.apple.")) throw new Error(`preserveAppDefaults refuses domain "${domain}": not an app's reverse-DNS identifier`);
  if (domain !== expected && domain !== `${expected}.driver`) throw new Error(`preserveAppDefaults refuses ${domain}: only the flow's app ${expected} (or its isolated ${expected}.driver copy) may be changed`);
  if (!keys.length || keys.some(key => !/^[A-Za-z0-9_.-]+$/.test(key))) throw new Error("preserveAppDefaults needs defaults keys such as AppleLanguages");
  const running = host.running(domain);
  if (running.length) throw new Error(`preserveAppDefaults needs ${domain} to be quit first, so the flow cannot change the defaults of a running copy; running: ${running.join(", ")}`);
  const saved = keys.map(key => ({ key, value: host.read(domain, key) }));
  return () => { for (const { key, value } of saved) value === undefined ? host.remove(domain, key) : host.write(domain, key, value); };
}

function macDefaultsHost(): DefaultsHost {
  const run = (command: string, args: string[], input?: string) => {
    const result = spawnSync(command, args, { encoding: "utf8", input });
    if (result.error) throw result.error;
    return result;
  };
  return {
    running: macHost().running,
    read(domain, key) {
      const exported = run("defaults", ["export", domain, "-"]);
      if (exported.status !== 0) throw new Error(`defaults export ${domain} failed (${exported.status}): ${exported.stderr.trim()}`);
      const value = run("plutil", ["-extract", key, "xml1", "-o", "-", "-"], exported.stdout);
      if (value.status === 0) return value.stdout;
      if (value.stderr.includes("No value at that key path")) return undefined;
      throw new Error(`plutil -extract ${key} failed (${value.status}): ${value.stderr.trim()}`);
    },
    write(domain, key, value) {
      const result = run("defaults", ["write", domain, key, value]);
      if (result.status !== 0) throw new Error(`defaults write ${domain} ${key} failed (${result.status}): ${result.stderr.trim()}`);
    },
    remove(domain, key) {
      const result = run("defaults", ["delete", domain, key]);
      if (result.status !== 0 && !/not found|Could not find key/.test(result.stderr)) throw new Error(`defaults delete ${domain} ${key} failed (${result.status}): ${result.stderr.trim()}`);
    },
  };
}
