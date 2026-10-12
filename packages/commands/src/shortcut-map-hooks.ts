import { useCallback, useSyncExternalStore } from "react";
import type { ShortcutMap, ShortcutMapSnapshot } from "./shortcut-map";

/** Observes a caller-owned map; unmount removes only this subscription, never the map. */
export function useShortcutMap<Id extends string>(map: ShortcutMap<Id>): ShortcutMapSnapshot<Id> {
  const subscribe = useCallback((notify: () => void) => { const subscription = map.addListener(notify); return () => subscription.remove(); }, [map]);
  return useSyncExternalStore(subscribe, map.getSnapshot);
}
