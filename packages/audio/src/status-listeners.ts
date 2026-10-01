import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { AudioStatus } from "./types";
import type { Subscription } from "@legendapp/spark-desktop-app/src/contracts";
/** Share one backend event stream without sampling reads or React state. */
export function statusListeners(subscribe: (listener: (status: AudioStatus) => void) => Subscription) {
  const listeners = new Set<(status: AudioStatus) => void>();
  let closed = false, starting = false;
  let subscription: Subscription | undefined;
  const deliver = (status: AudioStatus) => {
    // Snapshot preserves delivery order when callbacks add/remove subscriptions.
    if (!closed) for (const listener of [...listeners]) { try { if (!closed && listeners.has(listener)) listener(status); } catch (error) { console.error(error); } }
  };
  return {
    add(listener: (status: AudioStatus) => void) {
      if (closed) throw new SparkError("E_CLOSED", "Audio player has been removed");
      const entry = (status: AudioStatus) => listener(status);
      listeners.add(entry);
      if (!subscription && !starting) try {
        starting = true;
        const value = subscribe(deliver);
        if (closed || !listeners.size) value.remove(); else subscription = value;
      } catch (error) { listeners.delete(entry); throw error; }
      finally { starting = false; }
      return { remove() { listeners.delete(entry); if (!listeners.size) { subscription?.remove(); subscription = undefined; } } };
    },
    close() { closed = true; listeners.clear(); subscription?.remove(); subscription = undefined; },
  };
}
