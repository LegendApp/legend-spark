import { useSyncExternalStore } from "react";
import * as Runtimes from "@react-native-runtimes/core";
import { SparkError } from "@legendapp/spark/contracts";
import { createMenu, type Menu, type MenuItem } from "@legendapp/spark/menus";
import { createPluginHost, getPluginAvailability, PluginError, usePlugins, type PluginCapability, type PluginEntry, type PluginHost, type PluginJsonValue, type PluginManifest } from "@legendapp/spark/plugins";
import { getAppState } from "../../shell/app-controller";
import {
  HOST_GLOBAL, echoManifest, echoPlugin, futureManifest, futurePlugin, helloManifest, helloPlugin, overreachManifest, overreachPlugin,
  ungrantedManifest, ungrantedPlugin,
} from "../../plugin-tasks";
import { PLUGINS_MESSAGES } from "./plugins-messages";

// The Kitchen Sink's plugin service: one app-wide host (plugins stay loaded while the screen is closed, as an app's
// plugins would), the native "Plugins" menu built from loaded plugins' menu items, and the screen's last results.

/** The row key in test IDs: future-facing-capabilities-plugins-<short>-state. */
export const shortName = (manifest: PluginManifest) => manifest.id.slice(manifest.id.lastIndexOf(".") + 1);
/** The file the screen opens through the plugins' file types; nothing reads it. */
export const SAMPLE_FILE = "/tmp/kitchen-sink/sample.ksnote";

const declared: [PluginManifest, PluginEntry, readonly PluginCapability[]][] = [
  [helloManifest, helloPlugin, ["commands", "panels", "fileTypes", "menuItems"]],
  [echoManifest, echoPlugin, ["commands"]],
  [overreachManifest, overreachPlugin, ["commands"]],
  [futureManifest, futurePlugin, ["commands"]],
  [ungrantedManifest, ungrantedPlugin, ["commands"]],
];

type DemoState = { results: Readonly<Record<string, string>>; output?: string };
let demo: DemoState = { results: {} };
const listeners = new Set<() => void>();
function update(next: Partial<DemoState>) {
  demo = { ...demo, ...next };
  for (const listener of [...listeners]) listener();
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Results show the outcome or the error type and code only, so flows can assert them in any locale. */
const outcome = (cause: unknown) => cause instanceof PluginError ? `PluginError:${cause.phase}` : cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);

let host: PluginHost | undefined;
function pluginHost() {
  if (host) return host;
  // A plugin runtime that could read this would share the main heap.
  (globalThis as Record<string, unknown>)[HOST_GLOBAL] = true;
  host = createPluginHost({ runtimes: Runtimes, plugins: declared.map(([manifest, entry, grant]) => ({ manifest, entry, grant })), timeoutMs: 15000 });
  host.subscribe(publishMenu);
  return host;
}

// Loaded plugins' menu items, published as the app's Plugins menu while any are registered and removed with the last.
let menu: Menu | undefined;
let publishing = Promise.resolve();
function publishMenu() {
  const loaded = pluginHost().list().filter(plugin => plugin.state === "loaded");
  const items: MenuItem[] = loaded.flatMap(plugin => plugin.contributions.menuItems.map(item => ({ type: "action" as const, id: item.id, label: item.title })));
  const label = PLUGINS_MESSAGES[getAppState().locale ?? "en"].menu;
  publishing = publishing.then(async () => {
    if (!items.length) {
      await menu?.remove();
      menu = undefined;
    } else if (menu) await menu.update({ items: [{ type: "submenu", id: "ks-plugins-menu", label, items }] });
    else menu = await createMenu({ id: "ks-plugins", items: [{ type: "submenu", id: "ks-plugins-menu", label, items }], onAction: ({ itemId }) => void runMenuItem(itemId) });
  }).catch(cause => update({ output: `Plugins menu: ${outcome(cause)}` }));
}

async function execute(pluginId: string, command: string, args: PluginJsonValue = null) {
  try { update({ output: JSON.stringify(await pluginHost().execute(pluginId, command, args)) }); }
  catch (cause) { update({ output: outcome(cause) }); }
}

/** Runs the command a loaded plugin's menu item names, from the native menu or the screen's copy of it. */
export function runMenuItem(itemId: string) {
  for (const plugin of pluginHost().list()) {
    const item = plugin.contributions.menuItems.find(candidate => candidate.id === itemId);
    if (item) return execute(plugin.manifest.id, item.command);
  }
  update({ output: `SparkError:E_NOT_FOUND` });
  return Promise.resolve();
}

async function toggle(manifest: PluginManifest, action: "load" | "unload") {
  let result: string;
  try {
    if (action === "load") await pluginHost().load(manifest.id);
    else await pluginHost().unload(manifest.id);
    result = action === "load" ? "loaded" : "unloaded";
  } catch (cause) { result = outcome(cause); }
  update({ results: { ...demo.results, [shortName(manifest)]: result } });
}

/** Opens the sample file through the first loaded plugin whose file type accepts its extension. */
function openSample() {
  const [handler] = pluginHost().findFileHandlers(SAMPLE_FILE);
  if (!handler) { update({ output: "no handler" }); return Promise.resolve(); }
  return execute(handler.pluginId, handler.fileType.command, { path: SAMPLE_FILE });
}

/** Loads, unloads and runs the sample plugins through @legendapp/spark/plugins. */
export function usePluginsDemo() {
  const plugins = usePlugins(pluginHost());
  const { results, output } = useSyncExternalStore(subscribe, () => demo);
  return { availability: getPluginAvailability(), plugins, results, output, toggle, execute, runMenuItem, openSample };
}
