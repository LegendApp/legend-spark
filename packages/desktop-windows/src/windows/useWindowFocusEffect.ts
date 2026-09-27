import { useEffect, useRef } from "react";
import { nativeError, type AsyncRegistration, type SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { addWindowListener } from "../api";
import { useWindowId } from "./WindowProvider";
export interface WindowHookOptions { onError?: (error: SparkError) => void }
export function useWindowFocusEffect(callback: () => void, options: WindowHookOptions = {}) {
  const id = useWindowId(), latest = useRef({ callback, onError: options.onError }); latest.current = { callback, onError: options.onError };
  useEffect(() => {
    let disposed = false, registration: AsyncRegistration | undefined;
    const report = (cause: unknown) => { if (latest.current.onError) latest.current.onError(nativeError(cause)); else console.error(cause); };
    void addWindowListener(id, "focusChanged", event => { if (!disposed && event.focused) latest.current.callback(); }, { onError: report }).then(value => {
      if (disposed) void value.remove().catch(report); else registration = value;
    }).catch(report);
    return () => { disposed = true; void registration?.remove().catch(report); };
  }, [id]);
}
