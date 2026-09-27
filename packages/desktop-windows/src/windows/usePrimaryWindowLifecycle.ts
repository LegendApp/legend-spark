import { useEffect, useRef } from "react";
import { addAppListener } from "@legendapp/spark-desktop-app";
import { nativeError, type SparkError } from "@legendapp/spark-desktop-app/src/contracts";
export interface UsePrimaryWindowLifecycleOptions {
  windowId: string;
  onInitialOpen: () => void | Promise<void>;
  onReopenRequested?: () => void | Promise<void>;
  onWindowClosed?: () => void;
  onError: (error: SparkError) => void;
}
export function usePrimaryWindowLifecycle(options: UsePrimaryWindowLifecycleOptions) {
  const latest = useRef(options); latest.current = options;
  const opened = useRef<{ id: string; promise: Promise<void> } | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    const report = (cause: unknown) => latest.current.onError(nativeError(cause));
    const run = (action: (() => void | Promise<void>) | undefined) => { if (action) void Promise.resolve().then(() => { if (!disposed) return action(); }).catch(report); };
    const reopened = addAppListener("reopen", event => { if (!event.hasVisibleWindows) run(latest.current.onReopenRequested); });
    if (opened.current?.id !== options.windowId) {
      let promise: Promise<void>;
      try { promise = Promise.resolve(latest.current.onInitialOpen()); } catch (cause) { promise = Promise.reject(cause); }
      opened.current = { id: options.windowId, promise };
    }
    // App-level registry events intentionally follow all instances of this logical window.
    const closed = addAppListener("windowClosed", event => {
      if (!disposed && event.windowId === options.windowId) latest.current.onWindowClosed?.();
    });
    void opened.current.promise.catch(cause => { if (!disposed) report(cause); });
    return () => { disposed = true; reopened.remove(); closed.remove(); };
  }, [options.windowId]);
}
