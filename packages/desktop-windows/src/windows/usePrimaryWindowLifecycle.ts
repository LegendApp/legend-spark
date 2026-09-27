import { useEffect, useRef } from "react";

export type UsePrimaryWindowLifecycleOptions = {
  onInitialOpen: () => Promise<void> | void;
  onReopenRequested?: () => Promise<void> | void;
  onWindowClosed?: () => void;
  reportError: (error: unknown) => void;
  windowIdentifier?: string;
};

function runLifecycleAction(action: () => Promise<void> | void, reportError: (error: unknown) => void) {
  Promise.resolve().then(action).catch(reportError);
}

export function usePrimaryWindowLifecycle({
  onInitialOpen,
  onReopenRequested,
  onWindowClosed,
  reportError,
  windowIdentifier,
}: UsePrimaryWindowLifecycleOptions) {
  const didOpenRef = useRef(false);

  useEffect(() => {
    if (!didOpenRef.current) {
      didOpenRef.current = true;
      runLifecycleAction(onInitialOpen, reportError);
    }
  }, [onInitialOpen, reportError]);

  useEffect(() => {
    if (!onReopenRequested && !(onWindowClosed && windowIdentifier)) return;
    let disposed = false;
    const subscriptions: { remove(): void }[] = [];
    // Loading document request/history APIs must not load the managed-window module.
    void import("@legendapp/spark-desktop-windows/src/window-manager").then(native => {
      if (disposed) return;
      if (onReopenRequested) subscriptions.push(native.addApplicationReopenRequestedListener(({ hasVisibleWindows }) => {
        if (!hasVisibleWindows) runLifecycleAction(onReopenRequested, reportError);
      }));
      if (onWindowClosed && windowIdentifier) subscriptions.push(native.addWindowClosedListener(({ identifier }) => {
        if (identifier === windowIdentifier) onWindowClosed();
      }));
    }).catch(error => { for (const subscription of subscriptions) subscription.remove(); if (!disposed) reportError(error); });
    return () => { disposed = true; for (const subscription of subscriptions) subscription.remove(); };
  }, [onReopenRequested, onWindowClosed, windowIdentifier, reportError]);
}
