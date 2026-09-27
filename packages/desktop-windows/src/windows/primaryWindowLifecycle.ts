import { addAppListener } from "@legendapp/spark-desktop-app";
import { SparkError, nativeError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";

export interface PrimaryWindowLifecycleOptions {
  windowId: string;
  onInitialOpen: () => void | Promise<void>;
  onReopenRequested?: () => void | Promise<void>;
  onWindowClosed?: () => void;
  onError: (error: SparkError) => void;
}

/** Owns application events for one logical window, including reopened instances. */
export function createPrimaryWindowLifecycle(options: PrimaryWindowLifecycleOptions): Subscription {
  const { windowId, onInitialOpen, onReopenRequested, onWindowClosed, onError } = options;
  if (typeof windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(windowId)) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected a window ID");
  }
  let active = true;
  const run = (action: (() => void | Promise<void>) | undefined) => {
    if (active && action) void Promise.resolve().then(() => { if (active) return action(); })
      .catch(cause => onError(nativeError(cause)));
  };
  const reopened = addAppListener("reopen", event => { if (!event.hasVisibleWindows) run(onReopenRequested); });
  let closed: Subscription;
  try {
    closed = addAppListener("windowClosed", event => {
      if (active && event.windowId === windowId && onWindowClosed) {
        try { onWindowClosed(); } catch (cause) { onError(nativeError(cause)); }
      }
    });
  } catch (error) { active = false; reopened.remove(); throw error; }
  run(onInitialOpen);
  return { remove() { active = false; reopened.remove(); closed.remove(); } };
}
