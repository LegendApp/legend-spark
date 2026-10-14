import { useEffect, useState } from "react";
import { getCustomizeState, onCustomizeState, type CustomizeState } from "./customize";

export type CustomizeHookState = { status: "loading" } | { status: "ready"; state: CustomizeState } | { status: "error"; error: unknown };
/** Observes the app-owned customization session. Unmount removes observation, never cancels an operation. */
export function useCustomizeState(): CustomizeHookState {
  const [current, setCurrent] = useState<CustomizeHookState>({ status: "loading" });
  useEffect(() => {
    let active = true, receivedEvent = false;
    try {
      const subscription = onCustomizeState(state => { receivedEvent = true; setCurrent({ status: "ready", state }); });
      getCustomizeState().then(state => { if (active && !receivedEvent) setCurrent({ status: "ready", state }); }, error => { if (active && !receivedEvent) setCurrent({ status: "error", error }); });
      return () => { active = false; subscription.remove(); };
    } catch (error) { setCurrent({ status: "error", error }); }
  }, []);
  return current;
}
