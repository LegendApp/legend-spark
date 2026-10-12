import { useCallback, useContext, useSyncExternalStore } from "react";
import type { Observable } from "@legendapp/state";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { WindowInstanceContext } from "./root";
import type { WindowState } from "./state";
import type { UndoState, WindowInstance } from "./types";

/** The navigator window owning this React root. Throws outside a navigator root. */
export function useWindowInstance(): WindowInstance {
  const instance = useContext(WindowInstanceContext);
  if (!instance) throw new SparkError("E_UNAVAILABLE", "useWindowInstance requires a root opened through createWindowsNavigator");
  return instance;
}
/** Observes this window's undo stack. */
export function useUndoState(): UndoState {
  const { undo } = useWindowInstance();
  const subscribe = useCallback((changed: () => void) => { const subscription = undo.subscribe(changed); return () => subscription.remove(); }, [undo]);
  return useSyncExternalStore(subscribe, undo.getState);
}
/** This window's binding in a scoped state; re-renders when the binding (not the value) changes. */
export function useWindowState<T>(state: WindowState<T>): Observable<T> {
  const instance = useWindowInstance();
  const subscribe = useCallback((changed: () => void) => { const subscription = state.subscribe(instance, changed); return () => subscription.remove(); }, [state, instance]);
  const get = useCallback(() => state.get(instance), [state, instance]);
  return useSyncExternalStore(subscribe, get);
}
