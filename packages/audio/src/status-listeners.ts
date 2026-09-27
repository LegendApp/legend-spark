import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { AudioStatus } from "./types";
/** Sample status only while observed. No React state or render is involved. */
export function statusListeners(read: () => Promise<AudioStatus>) {
  const listeners = new Set<(status: AudioStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, running = false;
  async function tick() {
    timer = undefined; running = true;
    try {
      const status = await read();
      if (!closed) for (const listener of [...listeners]) { try { if (!closed && listeners.has(listener)) listener(status); } catch (error) { console.error(error); } }
    } catch (error) { if (!closed) console.error(error); }
    finally { running = false; if (!closed && listeners.size) timer = setTimeout(tick, 250); }
  }
  return {
    add(listener: (status: AudioStatus) => void) {
      if (closed) throw new SparkError("E_CLOSED", "Audio player has been removed");
      const entry = (status: AudioStatus) => listener(status);
      listeners.add(entry); if (!running && !timer) void tick();
      return { remove() { listeners.delete(entry); if (!listeners.size) { clearTimeout(timer); timer = undefined; } } };
    },
    close() { closed = true; clearTimeout(timer); listeners.clear(); },
  };
}
