import { useCallback, useSyncExternalStore } from "react";
import type { PluginHost, PluginInfo } from "./types";

/** Observes a host the caller owns: re-renders when a plugin's state or contributions change. Never unloads anything. */
export function usePlugins(host: PluginHost): readonly PluginInfo[] {
  const subscribe = useCallback((listener: () => void) => {
    const subscription = host.subscribe(listener);
    return () => subscription.remove();
  }, [host]);
  return useSyncExternalStore(subscribe, host.list, host.list);
}
