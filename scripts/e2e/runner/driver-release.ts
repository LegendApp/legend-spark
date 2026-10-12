// The release-safety probe of the driver backend (docs/e2e-flows.md#release-safety-probe, #274): what `assertNoDebugSurface`
// judges in a running app. A driven release build listens on nothing but the driver's channel, holds no network socket,
// never contacts the development server it is pointed at, and has no Developer menu or other debug items in its menus.
import net from "node:net";
import { developerMenuMessages } from "../../../packages/native-menu/src/developer-menu-messages.ts";
import type { DriverMenuItem, ProcessSocket } from "../driver.ts";

/** The Developer menu's item titles in every language it has, and its item identifiers' prefix (packages/native-menu/src/developer-menu.ts). */
const DEVELOPER_TITLES = new Set(["en", "ar"].map(developerMenuMessages).flatMap(messages =>
  [messages.menu, messages.reload, messages.openDevTools, messages.toggleInspector, messages.togglePerfMonitor, messages.fastRefresh, messages.bundleInfo, messages.showMenu]));
const DEVELOPER_ID = "spark-developer";
/** Other debug tooling a menu could offer: DevTools, inspectors, debuggers, a dev menu. */
const DEBUG_TITLE = /\b(dev ?tools|inspector|debug(ger|ging)?|dev(eloper)? menu)\b/i;

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
