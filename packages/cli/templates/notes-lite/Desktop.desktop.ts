import { addWindowListener, getDisplays, listWindows, openWindow, setWindowBounds, showWindow } from "@legendapp/spark/windows";
import type { AsyncRegistration } from "@legendapp/spark/contracts";
import { notes } from "./store";
import { WindowSession } from "./window-session";
export const desktop = true;
const session = new WindowSession(notes, {
  list: async () => (await listWindows()).map(window => ({ id: window.id, frame: window.bounds })),
  workAreas: async () => (await getDisplays()).sort((a, b) => Number(b.primary) - Number(a.primary)).map(display => ({ ...display.workArea, displayId: display.id })),
  show: showWindow,
  frame: setWindowBounds,
  open: window => openWindow({ id: window.id, component: "main", title: window.id === "settings" ? "Notes Settings" : "Notes", size: { width: window.frame.width, height: window.frame.height }, position: { displayId: window.frame.displayId, x: window.frame.x, y: window.frame.y }, props: { windowId: window.id, windowProps: window.id === "settings" ? { settings: true } : { noteId: window.noteId } } }),
});
const watchers = new Set<(message: string) => void>();
const registrations = new Map<string, AsyncRegistration[]>();
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
function report(error: unknown) { for (const watcher of watchers) watcher(String(error)); }
function changed() { clearTimeout(timer); timer = setTimeout(() => { void session.capture().catch(report); }, 150); }
let pending: Promise<void> = Promise.resolve();
function observeWindows() {
  const epoch = generation;
  const task = pending.then(async () => {
    if (!watchers.size || epoch !== generation) return;
    for (const window of await listWindows()) {
      if (!session.known(window.id) || registrations.has(window.id)) continue;
      const owned: AsyncRegistration[] = [];
      try {
        owned.push(await addWindowListener(window.id, "boundsChanged", changed));
        owned.push(await addWindowListener(window.id, "closed", () => { registrations.delete(window.id); for (const value of owned) void value.remove().catch(report); changed(); }));
        if (watchers.size && epoch === generation) registrations.set(window.id, owned);
        else for (const value of owned) await value.remove();
      } catch (error) { for (const value of owned) await value.remove(); throw error; }
    }
  });
  pending = task.catch(() => {}); return task;
}
export async function openNote(noteId: string) { await session.openNote(noteId); await observeWindows(); }
export async function openSettings() { await session.openSettings(); await observeWindows(); }
export const showNotebook = () => showWindow("main");
export async function restoreSession() { await session.restore(); await observeWindows(); }
export const flushSession = session.quit;
export function watchSession(onError: (message: string) => void) {
  watchers.add(onError); void observeWindows().catch(report);
  return { remove() {
    watchers.delete(onError);
    if (!watchers.size) { generation++; clearTimeout(timer); for (const owned of registrations.values()) for (const value of owned) void value.remove().catch(console.error); registrations.clear(); }
  } };
}
