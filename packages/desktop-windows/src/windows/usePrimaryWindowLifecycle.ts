import { useEffect, useLayoutEffect, useRef } from "react";
import { createPrimaryWindowLifecycle, validatePrimaryWindowLifecycleOptions, type PrimaryWindowLifecycleOptions } from "./primaryWindowLifecycle";
export type UsePrimaryWindowLifecycleOptions = PrimaryWindowLifecycleOptions;

export function usePrimaryWindowLifecycle(options: UsePrimaryWindowLifecycleOptions): void {
  validatePrimaryWindowLifecycleOptions(options);
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    const registration = createPrimaryWindowLifecycle({
      windowId: options.windowId,
      onInitialOpen: () => latest.current.onInitialOpen(),
      onReopenRequested: () => latest.current.onReopenRequested?.(),
      onWindowClosed: () => latest.current.onWindowClosed?.(),
      onError: error => latest.current.onError(error),
    });
    return () => registration.remove();
  }, [options.windowId]);
}
