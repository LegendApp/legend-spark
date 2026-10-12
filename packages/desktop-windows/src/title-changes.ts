/**
 * Internal: `setWindowOptions` reports title changes here, because no native event carries them.
 * Window sessions save titles, so the navigator listens.
 */
const listeners = new Set<(windowId: string) => void>();
export function addTitleListener(listener: (windowId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function titleChanged(windowId: string) {
  for (const listener of [...listeners]) { try { listener(windowId); } catch (error) { console.error(error); } }
}
