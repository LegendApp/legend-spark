import { useEffect, useState } from "react";
import { getEditingState, onEditingState, type EditingState } from "./editable";

export type EditingHookState = { status: "loading" } | { status: "ready"; state: EditingState } | { status: "error"; error: unknown };
/** Observes the app-owned editing session. Unmount removes observation, never cancels an operation. */
export function useEditingState(): EditingHookState {
  const [current, setCurrent] = useState<EditingHookState>({ status: "loading" });
  useEffect(() => {
    let active = true, receivedEvent = false;
    try {
      const subscription = onEditingState(state => { receivedEvent = true; setCurrent({ status: "ready", state }); });
      getEditingState().then(state => { if (active && !receivedEvent) setCurrent({ status: "ready", state }); }, error => { if (active && !receivedEvent) setCurrent({ status: "error", error }); });
      return () => { active = false; subscription.remove(); };
    } catch (error) { setCurrent({ status: "error", error }); }
  }, []);
  return current;
}
