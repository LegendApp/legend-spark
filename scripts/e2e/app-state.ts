// `launchApp: { clearState: true }` for a macOS Spark app (docs/e2e-flows.md#clearstate): delete what the app persisted,
// found by reading the Spark and React Native code, and nothing else. Every path is derived from the app's bundle
// identifier or its Spark namespace; nothing is globbed.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, mkdtempSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** `bundleId` is CFBundleIdentifier; `projectId` is SparkProjectIdentifier, which the host falls back to the bundle id for. */
export type AppIdentity = { bundleId: string; projectId: string; sandboxed: boolean };
export type StateHost = {
  home: string;
  /** The app's NSTemporaryDirectory(): the per-user temporary directory of an app that is not sandboxed. */
  temp: string;
  /** Running processes of the app, by bundle identifier. */
  running(bundleId: string): string[];
  /** `defaults delete <domain>`; false when the domain does not exist. */
  deleteDefaults(domain: string): boolean;
};

type DriverState = { executable: string; clear(): string[]; close(): void };
type DriverSource = AppIdentity & { app: string; executable: string; entitlements: string };

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+){2,}$/;

/** `SparkNamespace()` in packages/desktop-app/macos/SparkDesktop.mm: the per-project prefix of Spark's own storage. */
export const sparkNamespace = (projectId: string) => `spark.desktop.${createHash("sha256").update(projectId).digest("hex")}`;

/** Every file and directory clearState deletes, besides the `defaults` domain named by the bundle identifier. */
export function statePaths({ bundleId, projectId }: AppIdentity, { home, temp }: Pick<StateHost, "home" | "temp">): string[] {
  const ns = sparkNamespace(projectId), instance = sparkNamespace(bundleId), library = path.join(home, "Library");
  return [
    path.join(library, "Application Support", bundleId), // Spark data/MMKV, React Native AsyncStorage and Nitro SQLite
    path.join(library, "Caches", ns), // legacy library caches
    path.join(library, "Caches", bundleId), // file-system "cache", NSURLCache, Sparkle downloads, WebKit caches
    path.join(library, "HTTPStorages", bundleId), // NSURLSession cookies and HSTS
    path.join(library, "HTTPStorages", `${bundleId}.binarycookies`),
    path.join(library, "Cookies", `${bundleId}.binarycookies`),
    path.join(library, "WebKit", bundleId), // WKWebsiteDataStore.defaultDataStore
    path.join(library, "Saved Application State", `${bundleId}.savedState`), // AppKit window restoration
    path.join(temp, bundleId, "Spark"), // file-system "temp"
    ...[".setup", ".lock", ".sock"].map(suffix => path.join(temp, `${instance}${suffix}`)), // the single-instance lock
    path.join(temp, "legend-codex-workspace", `codex-home-${bundleId}`), // the codex package's CODEX_HOME
  ];
}

/**
 * Deletes the app's persisted state and returns what existed: the `defaults` domain (as `defaults:<bundle id>`) and
 * the paths of `statePaths`. Refuses an identifier that is not `expected` (the gate manifest's appId) or not a
 * reverse-DNS app identifier, a sandboxed app, and an app that is running.
 */
export function clearAppState(identity: AppIdentity, expected: string, host: StateHost = macHost()): string[] {
  const { bundleId, projectId } = identity;
  if (!BUNDLE_ID.test(bundleId) || bundleId.startsWith("com.apple.")) throw new Error(`clearState refuses bundle identifier "${bundleId}": not an app's reverse-DNS identifier`);
  if (bundleId !== expected) throw new Error(`clearState refuses ${bundleId}: only the gate manifest's app ${expected} may be cleared`);
  if (!projectId.trim()) throw new Error(`clearState refuses ${bundleId}: its Spark project identifier is empty`);
  // Removing another app's container needs the "access data from other apps" permission, which would prompt.
  if (identity.sandboxed) throw new Error(`clearState does not support sandboxed apps: ${bundleId} keeps its state in ~/Library/Containers/${bundleId}`);
  // cfprefsd and the app's open files would write the state back.
  const running = host.running(bundleId);
  if (running.length) throw new Error(`clearState needs ${bundleId} to be quit first; running: ${running.join(", ")}`);
  checkRoots(host);
  const cleared = host.deleteDefaults(bundleId) ? [`defaults:${bundleId}`] : [];
  for (const file of statePaths(identity, host)) {
    if (!lstatSync(file, { throwIfNoEntry: false })) continue;
    rmSync(file, { recursive: true }); // a symbolic link is removed itself, never followed
    cleared.push(file);
  }
  return cleared;
}

function checkRoots(host: StateHost) {
  for (const [name, root] of [["home", host.home], ["temp", host.temp]] as const) {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) throw new Error(`clearState refuses: the ${name} directory "${root}" is not an absolute, non-root path`);
  }
}

export function prepareDriverState(source: DriverSource, exactAppId: string | undefined, host: StateHost = macHost()): DriverState {
  checkRoots(host);
  if (exactAppId !== undefined) {
    const lock = path.join(host.temp, `${sparkNamespace(source.bundleId)}.driver.lock`);
    const fd = openSync(lock, constants.O_CREAT | constants.O_RDONLY | constants.O_NOFOLLOW, 0o600);
    try {
      // lockf locks the inherited descriptor until this process closes its copy.
      execFileSync("/usr/bin/lockf", ["-t", "0", "3"], { stdio: ["ignore", "pipe", "pipe", fd] });
      const running = host.running(source.bundleId);
      if (running.length) throw new Error(`Quit ${source.bundleId} before driving the exact artifact: ${running.join(", ")}`);
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    return { executable: source.executable, clear: () => clearAppState(source, exactAppId, host), close: () => closeSync(fd) };
  }

  if (source.sandboxed || /<key>(?:application-identifier|com\.apple\.application-identifier|com\.apple\.developer\.[^<]+|com\.apple\.security\.application-groups|keychain-access-groups)<\/key>/.test(source.entitlements))
    throw new Error(`Cannot isolate ${source.bundleId}: sandboxing or identity-bound entitlements prevent a safe ad hoc clone`);

  const bundleId = `so.legend.spark.driver.${randomUUID()}`;
  const identity = { bundleId, projectId: bundleId, sandboxed: false };
  const dir = mkdtempSync(path.join(host.temp, "spark-driver-state-"));
  const clone = path.join(dir, path.basename(source.app)), contents = path.join(clone, "Contents");
  const plist = path.join(contents, "Info.plist");
  try {
    execFileSync("/bin/cp", ["-cR", source.app, clone]);
    if (!lstatSync(clone).isDirectory() || !lstatSync(contents).isDirectory() || !lstatSync(plist).isFile())
      throw new Error(`Cannot isolate ${source.app}: expected a regular app bundle and Info.plist`);
    for (const [key, value] of Object.entries({ CFBundleIdentifier: bundleId, SparkProjectIdentifier: bundleId, SparkDefaultBundleIdentifier: source.bundleId }))
      execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
    for (const key of ["CFBundleURLTypes", "CFBundleDocumentTypes"])
      execFileSync("/usr/bin/plutil", ["-replace", key, "-json", "[]", plist]);
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags", clone], { stdio: "pipe" });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const clear = () => clearAppState(identity, bundleId, host);
  return {
    executable: path.join(clone, path.relative(source.app, source.executable)),
    clear,
    close() {
      clear();
      rmSync(path.join(host.temp, bundleId), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function macHost(): StateHost {
  const text = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  };
  return {
    home: os.homedir(),
    temp: text("getconf", ["DARWIN_USER_TEMP_DIR"]).stdout.trim(),
    running(bundleId) {
      const result = text("lsappinfo", ["find", `bundleid=${bundleId}`]);
      if (result.status !== 0) throw new Error(`lsappinfo could not check ${bundleId}: ${result.stderr.trim()}`);
      return result.stdout.trim().split("\n").filter(Boolean);
    },
    deleteDefaults(domain) {
      const result = text("defaults", ["delete", domain]);
      if (result.status === 0) return true;
      if (result.stderr.includes(`Domain '${domain}' not found`) || result.stderr.includes(`Domain (${domain}) not found.`)) return false;
      throw new Error(`defaults delete ${domain} failed (${result.status}): ${result.stderr.trim()}`);
    },
  };
}
