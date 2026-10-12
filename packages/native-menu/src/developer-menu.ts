// The Developer menu. Development builds only: @legendapp/spark/runtime-entry requires this module inside
// `if (__DEV__)`, so Metro drops it, and everything only it imports, from release bundles
// (tests/developer-menu-release.test.ts). The macOS adapter performs its items against the key window's runtime
// (packages/native-menu/ios/SparkDeveloperMenu.mm, compiled only when RCT_DEV).
import { NativeEventEmitter, Platform } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { formatAccelerator, parseAccelerator } from "@legendapp/spark-desktop-app/src/contracts/accelerator";
import { getDevToolsOpener, observeDevToolsOpener, type DeveloperRuntimeTarget } from "@legendapp/spark-desktop-app/src/contracts/developer-tools";
import { getProfilerAvailability, startProfiling, stopProfiling, type ProfilingResult } from "@legendapp/spark-desktop-app/src/profiler";
import type { MenuDeveloperWire, MenuWireItem } from "@legendapp/spark-desktop-app/src/contracts/menu";
import { getReservedShortcuts } from "@legendapp/spark-desktop-app/src/contracts/reserved-shortcuts";
import { getShortcutInventory, observeShortcutInventory, type ShortcutInventoryEntry } from "@legendapp/spark-desktop-app/src/contracts/shortcut-inventory";
import { getSystemInfo } from "@legendapp/spark-system";
import { createMenu, getMenuAvailability, type MenuRootItem } from "./api";
import { developerMenuMessages, type DeveloperMenuMessages } from "./developer-menu-messages";
import { setDeveloperMenuState, type DeveloperMenuShortcutConflict } from "./developer-menu-state";
import NativeMenu from "./NativeMenu";
import { wireDecorators } from "./wire-decorators";

export const DEVELOPER_MENU_ID = "spark-developer";
/** React Native's iOS Simulator dev menu shortcut. Not reserved by macOS (getReservedShortcuts) and unused by Spark. */
export const DEVELOPER_MENU_SHORTCUT = "Ctrl+Cmd+Z";
export const DEVELOPER_ITEM_IDS = {
  root: "spark-developer", reload: "spark-developer-reload", devTools: "spark-developer-devtools", inspector: "spark-developer-inspector",
  perfMonitor: "spark-developer-perf-monitor", fastRefresh: "spark-developer-fast-refresh", startProfiling: "spark-developer-start-profiling",
  stopProfiling: "spark-developer-stop-profiling", bundleInfo: "spark-developer-bundle-info", show: "spark-developer-show",
} as const;
const ID = DEVELOPER_ITEM_IDS;

/** The menu as every other owner publishes it; the adapter's state (enablement, Fast Refresh check) follows the key window. */
export function developerMenuItems(messages: DeveloperMenuMessages): MenuRootItem[] {
  return [{ type: "submenu", id: ID.root, label: messages.menu, placement: { before: { menu: "window" } }, items: [
    { type: "action", id: ID.reload, label: messages.reload },
    { type: "separator" },
    { type: "action", id: ID.devTools, label: messages.openDevTools },
    { type: "action", id: ID.inspector, label: messages.toggleInspector },
    { type: "action", id: ID.perfMonitor, label: messages.togglePerfMonitor },
    { type: "checkbox", id: ID.fastRefresh, label: messages.fastRefresh, checked: false },
    { type: "separator" },
    { type: "action", id: ID.startProfiling, label: messages.startProfiling },
    { type: "action", id: ID.stopProfiling, label: messages.stopProfiling },
    { type: "separator" },
    { type: "action", id: ID.bundleInfo, label: messages.bundleInfo },
  ] }];
}

export interface DeveloperMenuOptions { messages: DeveloperMenuMessages; shortcut: string | null; devToolsAvailable: boolean; profilerAvailable: boolean; lines: string[] }

/** Attaches the adapter instructions and, when the shortcut is free, the hidden item whose key equivalent pops up the menu. */
export function decorateDeveloperMenu(items: MenuWireItem[], { messages, shortcut, devToolsAvailable, profilerAvailable, lines }: DeveloperMenuOptions): void {
  const root = items.find(item => item.id === ID.root);
  if (!root?.items) throw new SparkError("E_INVALID_DATA", "The Developer menu root is missing");
  const actions: Record<string, MenuDeveloperWire> = {
    [ID.reload]: { action: "reload" },
    [ID.devTools]: devToolsAvailable ? { action: "openDevTools", available: true } : { action: "openDevTools", available: false, toolTip: messages.devToolsUnavailable },
    [ID.inspector]: { action: "toggleInspector" },
    [ID.perfMonitor]: { action: "togglePerfMonitor" },
    [ID.fastRefresh]: { action: "toggleFastRefresh" },
    [ID.startProfiling]: profilerAvailable ? { action: "startProfiling", available: true } : { action: "startProfiling", available: false, toolTip: messages.profilerUnavailable },
    [ID.stopProfiling]: { action: "stopProfiling", prompt: messages.saveProfile, message: messages.saveProfileMessage },
    [ID.bundleInfo]: { action: "bundleInfo", title: messages.bundleInfoTitle, ok: messages.ok, copy: messages.copy, labels: { bundleURL: messages.bundleURL, runtime: messages.runtime }, runtimes: { shared: messages.sharedRuntime, isolated: messages.isolatedRuntime }, lines },
  };
  for (const item of root.items) if (item.id && actions[item.id]) item._sparkDev = actions[item.id];
  if (shortcut) root.items.push({ id: ID.show, title: messages.showMenu, enabled: true, hidden: true, shortcut: parseAccelerator(shortcut, "macos"), _sparkDev: { action: "showMenu" } });
}

const lenient = { allowUnmodifiedCharacter: true, allowExtendedKeys: true };
const keyOf = (accelerator: string) => formatAccelerator(parseAccelerator(accelerator, "macos", lenient));
function owner(entry: ShortcutInventoryEntry): Pick<DeveloperMenuShortcutConflict, "with" | "description"> {
  const { owner } = entry;
  if (owner.source === "menu") return { with: "menu", description: `menu ${owner.menuId}, item ${owner.itemId}` };
  if (owner.source === "shortcut") return { with: "shortcut", description: owner.windowId ? `a shortcut registered for window ${owner.windowId}` : "an application shortcut" };
  return { with: "global-shortcut", description: "a global shortcut" };
}

/** The shortcut, unless macOS reserves it or another menu, shortcut or global shortcut already owns it. */
export function resolveDeveloperShortcut(candidate: string, inventory: readonly ShortcutInventoryEntry[]): { shortcut: string | null; conflict?: DeveloperMenuShortcutConflict } {
  const key = keyOf(candidate);
  const reserved = getReservedShortcuts("macos").find(entry => keyOf(entry.accelerator) === key);
  if (reserved) return { shortcut: null, conflict: { shortcut: candidate, with: "system", description: reserved.description } };
  const taken = inventory.find(entry => !(entry.owner.source === "menu" && entry.owner.menuId === DEVELOPER_MENU_ID) && formatAccelerator(entry.accelerator) === key);
  return taken ? { shortcut: null, conflict: { shortcut: candidate, ...owner(taken) } } : { shortcut: candidate };
}

type Globals = { HermesInternal?: { getRuntimeProperties?: () => Record<string, unknown> }; RN$Bridgeless?: boolean };
/** Runtime-wide facts for Show Bundle Info. Every runtime uses the host's engine, React Native and Spark. */
export function bundleInfoLines(messages: DeveloperMenuMessages, globals: Globals = globalThis as Globals): string[] {
  const hermes = globals.HermesInternal, release = hermes?.getRuntimeProperties?.()["OSS Release Version"];
  const native = (Platform.constants as { reactNativeVersion?: { major: number; minor: number; patch: number; prerelease?: string | number | null } }).reactNativeVersion;
  return [
    `${messages.mode}: ${globals.RN$Bridgeless ? messages.developmentBridgeless : messages.development}`,
    `${messages.engine}: ${hermes ? `Hermes${typeof release === "string" ? ` ${release}` : ""}` : messages.notHermes}`,
    ...(native ? [`${messages.reactNative}: ${native.major}.${native.minor}.${native.patch}${native.prerelease ? `-${native.prerelease}` : ""}`] : []),
    // Spark packages are versioned in lockstep (tests/developer-menu.test.ts).
    `${messages.spark}: ${(require("../package.json") as { version: string }).version}`,
  ];
}

function isTarget(value: unknown): value is DeveloperRuntimeTarget {
  const target = value as Partial<{ runtime: string; name: unknown }> | undefined;
  return target?.runtime === "shared" || (target?.runtime === "isolated" && typeof target.name === "string" && target.name.length > 0);
}

function profileWritten(result: ProfilingResult) {
  const runtimes = result.profiles.map(profile => `${profile.path} (${profile.samples} samples${profile.sourceMaps === "applied" ? "" : `, no source maps: ${profile.reason}`})`);
  console.info(`Profile saved. Trace: ${result.trace}\n${runtimes.join("\n")}`);
}

let installation: Promise<void> | undefined;
/** Publishes the Developer menu once per JavaScript runtime lifetime; a reload starts a fresh one. */
export function installDeveloperMenu(): Promise<void> {
  return installation ??= install().catch(error => {
    setDeveloperMenuState({ status: "error", error });
    console.error("The Developer menu could not be installed", error);
  });
}

async function install() {
  // Windows menus have no developer adapter yet; the state reports it as unsupported.
  if (Platform.OS !== "macos") { setDeveloperMenuState({ status: "unavailable", reason: "unsupported-platform" }); return; }
  const availability = getMenuAvailability();
  if (!availability.available) { setDeveloperMenuState({ status: "unavailable", reason: availability.reason }); return; }
  setDeveloperMenuState({ status: "installing" });
  const messages = developerMenuMessages((await getSystemInfo()).locale), lines = bundleInfoLines(messages);
  let shortcut = resolveDeveloperShortcut(DEVELOPER_MENU_SHORTCUT, getShortcutInventory());
  let devToolsAvailable = getDevToolsOpener() !== undefined;
  // runtime-entry installs the profiler before the menu.
  const profilerAvailable = getProfilerAvailability().available;
  wireDecorators.set(DEVELOPER_MENU_ID, items => decorateDeveloperMenu(items, { messages, shortcut: shortcut.shortcut, devToolsAvailable, profilerAvailable, lines }));
  const items = developerMenuItems(messages);
  const menu = await createMenu({ id: DEVELOPER_MENU_ID, items });
  const ready = () => {
    if (shortcut.conflict) console.warn(`The Developer menu has no shortcut: ${shortcut.conflict.shortcut} belongs to ${shortcut.conflict.description}`);
    setDeveloperMenuState({ status: "ready", shortcut: shortcut.shortcut, ...(shortcut.conflict ? { shortcutConflict: shortcut.conflict } : {}) });
  };
  ready();
  // Another owner can claim the shortcut later, and DevTools support can register after startup.
  const refresh = () => {
    const nextShortcut = resolveDeveloperShortcut(DEVELOPER_MENU_SHORTCUT, getShortcutInventory()), nextDevTools = getDevToolsOpener() !== undefined;
    if (nextShortcut.shortcut === shortcut.shortcut && nextDevTools === devToolsAvailable) return;
    shortcut = nextShortcut; devToolsAvailable = nextDevTools;
    menu.update({ items }).then(ready, error => { setDeveloperMenuState({ status: "error", error }); console.error("The Developer menu could not be updated", error); });
  };
  observeShortcutInventory(refresh);
  observeDevToolsOpener(refresh);
  new NativeEventEmitter(NativeMenu as never).addListener("NativeDeveloperMenu", (event: { action?: unknown; target?: unknown; directory?: unknown }) => {
    if (event?.action === "startProfiling") { startProfiling().then(() => console.info("Profiling every JavaScript runtime; Developer › Stop Profiling… saves it"), error => console.error("Profiling could not start", error)); return; }
    if (event?.action === "stopProfiling" && typeof event.directory === "string") { stopProfiling({ directory: event.directory }).then(profileWritten, error => console.error("The profile could not be saved", error)); return; }
    if (event?.action !== "openDevTools" || !isTarget(event.target)) return;
    const open = getDevToolsOpener();
    if (!open) { console.error(new SparkError("E_UNAVAILABLE", "React Native DevTools is not available in this build")); return; }
    open(event.target).catch(error => console.error("Opening React Native DevTools failed", error));
  });
}
