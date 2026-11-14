import { addAppListener } from "@legendapp/spark-desktop-app";
import { keys, object, windowId } from "../validation";
import { SparkError, nativeError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";

export interface PrimaryWindowLifecycleOptions {
  windowId: string;
  onInitialOpen: () => void | Promise<void>;
  onReopenRequested?: () => void | Promise<void>;
  onWindowClosed?: () => void;
  onError: (error: SparkError) => void;
}

/** Shared validation for the imperative owner and its React binding. */
export function validatePrimaryWindowLifecycleOptions(options: PrimaryWindowLifecycleOptions): void {
  object(options, "primary window lifecycle options");
  keys(options, ["windowId", "onInitialOpen", "onReopenRequested", "onWindowClosed", "onError"]);
  windowId(options.windowId);
  for (const key of ["onInitialOpen", "onReopenRequested", "onWindowClosed", "onError"] as const) {
    if ((key === "onInitialOpen" || key === "onError" || options[key] !== undefined) && typeof options[key] !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Expected ${key} callback`);
  }
}

/** Owns application events for one logical window, including reopened instances. */
export function createPrimaryWindowLifecycle(options: PrimaryWindowLifecycleOptions): Subscription {
  validatePrimaryWindowLifecycleOptions(options);
  const { windowId, onInitialOpen, onReopenRequested, onWindowClosed, onError } = options;
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
