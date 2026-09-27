import { watch } from "@legendapp/spark-file-system";
import { SparkError, asyncRegistration, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";

export interface DocumentReloadOptions {
  path: string;
  delayMs?: number;
  onReload: () => void | Promise<void>;
  onError: (error: unknown) => void;
  shouldReload?: () => boolean;
}

/** Debounces file invalidations. Removal stops queued reloads and awaits any running reload. */
export async function watchDocumentReload(options: DocumentReloadOptions): Promise<AsyncRegistration> {
  const { path, delayMs = 100, onReload, onError, shouldReload } = options;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2147483647) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected a nonnegative timer delay");
  }
  let active = true, ready = false, invalidated = false, timeout: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  const invalidate = () => {
    if (!active) return;
    if (!ready) { invalidated = true; return; }
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      pending = pending.then(async () => {
        if (active && (!shouldReload || shouldReload())) await onReload();
      }).catch(onError);
    }, delayMs);
  };
  // Native backends can report an invalidation before registration is acknowledged.
  // Do not run application work until creation succeeds.
  const subscription = await watch(path, invalidate);
  ready = true;
  if (invalidated) invalidate();
  return asyncRegistration(() => { active = false; clearTimeout(timeout); }, async () => {
    await subscription.remove();
    await pending;
  });
}
