// The release-safety probe of the driver backend (docs/e2e-flows.md#release-safety-probe, #274): what `assertNoDebugSurface`
// judges in a running app. A driven release build listens on nothing but the driver's channel, holds no network socket,
// never contacts the development server it is pointed at, has no Developer menu or other debug items in its menus, its
// JavaScript contains no network inspector or React DevTools backend, and neither its JavaScript nor its native code
// contains the profiler.
import { readFileSync } from "node:fs";
import net from "node:net";
import { NETWORK_INSPECTOR_MARKER } from "../../../packages/desktop-app/src/network-inspector/marker.ts";
import { PROFILER_MARKER } from "../../../packages/desktop-app/src/profiler/marker.ts";
import { REACT_DEVTOOLS_MARKER } from "../../../packages/desktop-app/src/react-devtools/marker.ts";
import { isMachO, isScript, walk } from "../audit/bundle.ts";
import { developerMenuMessages } from "../../../packages/native-menu/src/developer-menu-messages.ts";
import type { DriverMenuItem, ProcessSocket } from "../driver.ts";

/** The Developer menu's item titles in every language it has, and its item identifiers' prefix (packages/native-menu/src/developer-menu.ts). */
const DEVELOPER_TITLES = new Set(["en", "ar"].map(developerMenuMessages).flatMap(messages =>
  [messages.menu, messages.reload, messages.openDevTools, messages.toggleInspector, messages.togglePerfMonitor, messages.fastRefresh, messages.startProfiling, messages.stopProfiling, messages.bundleInfo, messages.showMenu]));
const DEVELOPER_ID = "spark-developer";
/** Other debug tooling a menu could offer: DevTools, inspectors, debuggers, profilers, a dev menu. */
const DEBUG_TITLE = /\b(dev ?tools|inspector|debug(ger|ging)?|profil(er|ing)|dev(eloper)? menu)\b/i;

/** Every menu item, at any depth and hidden ones included, that is a Developer menu item or debug tooling, by title path. */
export function debugMenuItems(menus: readonly DriverMenuItem[], parent = ""): string[] {
  return menus.flatMap(item => {
    if (item.separator) return [];
    const at = parent ? `${parent} > ${item.title}` : item.title;
    const own = item.id?.startsWith(DEVELOPER_ID) || DEVELOPER_TITLES.has(item.title.trim()) || DEBUG_TITLE.test(item.title) ? [at] : [];
    return [...own, ...debugMenuItems(item.items ?? [], at)];
  });
}

/** /private/var/… and /var/… are one directory; lsof reports a socket by the path it was bound with. */
const comparable = (file: string) => file.replace(/^\/private\//, "/");

/**
 * Every socket the app should not hold: any network (IPv4 or IPv6) socket, listening or connected, and any bound Unix
 * socket (one with a path) other than the driver's channel (`driverSocket`). A driven app skips the single-instance lock,
 * so it has no single-instance socket either (docs/e2e-flows.md#app-state).
 */
export function socketProblems(sockets: readonly ProcessSocket[], driverSocket: string): string[] {
  return sockets.flatMap(({ fd, type, protocol, name, state }) => {
    const where = `fd ${fd}`;
    if (type === "IPv4" || type === "IPv6") return [`${where}: ${type} ${protocol ?? ""} ${name}${state ? ` (${state})` : ""}`.replace(/  +/g, " ")];
    if (type !== "unix" || !name.startsWith("/")) return [];
    if (comparable(name) === comparable(driverSocket)) return [];
    return [`${where}: Unix socket bound at ${name}`];
  });
}

/**
 * A local TCP listener that stands in for a development server: the probe launches the app pointed at it with the
 * settings a development build reads (React Native's packager host RCT_jsLocation and Spark's bundle URL), and any
 * connection is a finding. It accepts and closes every connection, recording the peer.
 */
export async function decoyServer() {
  const connections: string[] = [];
  const server = net.createServer(socket => { connections.push(`${socket.remoteAddress}:${socket.remotePort}`); socket.destroy(); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const host = `127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  return {
    arguments: ["-RCT_jsLocation", host],
    env: { SPARK_BUNDLE_URL: `http://${host}/index.bundle?platform=macos&dev=true&minify=false` },
    problems: () => connections.length ? [`connected ${connections.length} time${connections.length === 1 ? "" : "s"} to the development server it was given (${host}; from ${connections.join(", ")})`] : [],
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

/** A string only a debug tool puts in an app's code, which Hermes bytecode and native code keep, and what that tool is. */
export type CodeMarker = { marker: string; label: string };
/**
 * What no release build's JavaScript may contain: Spark's network inspector and profiler, and React DevTools' backend
 * (React Native's dispatcher for the DevTools frontend, react-devtools-core's entry point it connects through, and
 * Spark's Select element fix), all only in development bundles.
 */
export const SCRIPT_MARKERS: readonly CodeMarker[] = [
  { marker: NETWORK_INSPECTOR_MARKER, label: "network inspector" },
  { marker: PROFILER_MARKER, label: "profiler" },
  { marker: "__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__", label: "React DevTools backend" },
  { marker: "connectWithCustomMessagingProtocol", label: "React DevTools backend" },
  { marker: REACT_DEVTOOLS_MARKER, label: "React DevTools Select element fix" },
];
/** What no release build's native code may contain: the profiler's native half (SparkProfiler.mm). */
export const NATIVE_MARKERS: readonly CodeMarker[] = [{ marker: PROFILER_MARKER, label: "profiler" }];

/**
 * Every JavaScript file of the app (bundles and scripts, by extension, at any depth) that contains a `scripts` marker and
 * every Mach-O file that contains a `natives` marker. The app is walked once. An app with no JavaScript or no native
 * code to search is a finding too.
 */
export function codeProblems(app: string, scripts: readonly CodeMarker[] = SCRIPT_MARKERS, natives: readonly CodeMarker[] = NATIVE_MARKERS): string[] {
  const entries = walk(app), scriptFiles = entries.filter(isScript), binaries = entries.filter(isMachO);
  const found = (files: typeof entries, markers: readonly CodeMarker[]) => files.flatMap(entry => {
    const contents = readFileSync(entry.abs);
    return markers.filter(({ marker }) => contents.includes(marker)).map(({ marker, label }) => `${entry.rel} contains the ${label} (${marker})`);
  });
  const labels = (markers: readonly CodeMarker[]) => {
    const names = [...new Set(markers.map(({ label }) => `the ${label}`))];
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
  };
  return [
    ...scriptFiles.length ? found(scriptFiles, scripts) : [`no JavaScript bundle found in ${app} to check for ${labels(scripts)}`],
    ...binaries.length ? found(binaries, natives) : [`no native code found in ${app} to check for ${labels(natives)}`],
  ];
}
