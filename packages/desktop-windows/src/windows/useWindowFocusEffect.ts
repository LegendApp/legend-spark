import { useEffect, useLayoutEffect, useRef } from "react";
import { nativeError, SparkError, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { keys, object } from "../validation";
import { addWindowListener } from "../api";
import { useWindowId } from "./WindowProvider";
export interface WindowHookOptions { onError?: (error: SparkError) => void }
export function useWindowFocusEffect(callback: () => void, options: WindowHookOptions = {}) {
  object(options, "window focus options"); keys(options, ["onError"]);
  if (typeof callback !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected window focus callbacks");
  const id = useWindowId(), latest = useRef({ callback, onError: options.onError });
  useLayoutEffect(() => { latest.current = { callback, onError: options.onError }; }, [callback, options.onError]);
  useEffect(() => {
    let disposed = false, registration: AsyncRegistration | undefined;
    const report = (cause: unknown) => { if (latest.current.onError) latest.current.onError(nativeError(cause)); else console.error(cause); };
    void addWindowListener(id, "focusChanged", event => { if (!disposed && event.focused) latest.current.callback(); }, { onError: report }).then(value => {
      if (disposed) void value.remove().catch(report); else registration = value;
    }).catch(report);
    return () => { disposed = true; void registration?.remove().catch(report); };
  }, [id]);
}
