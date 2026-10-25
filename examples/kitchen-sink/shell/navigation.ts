import { useSyncExternalStore } from "react";
import * as links from "@legendapp/spark/links";
import { parseRouteURL, type Location } from "./routes";

let current: Location = { kind: "catalog" };
const listeners = new Set<() => void>();

export function getLocation(): Location { return current; }
export function navigate(location: Location) {
  current = location;
  for (const listener of listeners) listener();
}
export function openLink(url: string) { navigate(parseRouteURL(url)); }
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Routes the launch URL and every later spark-ks:// open to the catalog. */
export function listenForDeepLinks(onError: (error: unknown) => void): { remove(): void } {
  let live = false, removed = false;
  const subscription = links.addEventListener("url", event => { live = true; openLink(event.url); });
  // A live open that arrives first is newer than the launch URL.
  links.getInitialURL().then(url => { if (url && !live && !removed) openLink(url); }, onError);
  return { remove() { removed = true; subscription.remove(); } };
}

export function useLocation(): Location { return useSyncExternalStore(subscribe, getLocation); }
