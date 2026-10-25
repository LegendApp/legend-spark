export const SCHEME = "spark-ks";

export type Route =
  | { kind: "catalog" }
  | { kind: "area"; area: string }
  | { kind: "screen"; area: string; screen: string };
/** Why a link names no route; shell/i18n.ts holds the localized text. */
export type InvalidReason = "not-a-url" | "wrong-scheme" | "bad-path" | "bad-encoding";
/** A route, or a link that names no route. Unknown areas/screens are resolved by the catalog. */
export type Location = Route | { kind: "invalid"; url: string; reason: InvalidReason };

export function routeURL(route: Route): string {
  switch (route.kind) {
    case "catalog": return `${SCHEME}://`;
    case "area": return `${SCHEME}://${encodeURIComponent(route.area)}`;
    case "screen": return `${SCHEME}://${encodeURIComponent(route.area)}/${encodeURIComponent(route.screen)}`;
  }
}

/** Parses spark-ks://, spark-ks://<area> and spark-ks://<area>/<screen>; query and fragment are ignored. */
export function parseRouteURL(url: string): Location {
  // RN's URL polyfill lacks host/pathname, so parse the generic syntax directly.
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(url);
  if (!match) return { kind: "invalid", url, reason: "not-a-url" };
  if (match[1]!.toLowerCase() !== SCHEME) return { kind: "invalid", url, reason: "wrong-scheme" };
  const segments = match[3]!.split("/").filter(Boolean);
  if (segments.length > 1) return { kind: "invalid", url, reason: "bad-path" };
  let area: string, screen: string | undefined;
  try {
    area = decodeURIComponent(match[2]!).toLowerCase(); // Hosts are case-insensitive.
    screen = segments[0] === undefined ? undefined : decodeURIComponent(segments[0]);
  } catch {
    return { kind: "invalid", url, reason: "bad-encoding" };
  }
  if (!area) return screen === undefined ? { kind: "catalog" } : { kind: "invalid", url, reason: "bad-path" };
  return screen === undefined ? { kind: "area", area } : { kind: "screen", area, screen };
}
