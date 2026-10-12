import { observable } from "@legendapp/state";
import { createWindowState, type WindowErrorEvent, type WindowInstance } from "@legendapp/spark/windows";

/** App scope: one live document, shared by every note window and the main screen. */
export const document$ = observable({ text: "Edit me in any window." });
export const settings$ = observable({ uppercase: false });
/** The last few window errors reported by the navigator. */
export const errors$ = observable<string[]>([]);
export function reportWindowError({ windowId, phase, error }: WindowErrorEvent) {
  errors$.set(list => [...list.slice(-4), `${windowId} · ${phase}: ${error instanceof Error ? error.message : String(error)}`]);
}

/** Window scope: each note window starts with its own stars and can promote them to app scope. */
export const stars = createWindowState<{ count: number }>({ initial: () => ({ count: 0 }) });
export const PINNED = "pinned-stars";

export function addStar(window: WindowInstance) {
  const count$ = stars.get(window).count;
  count$.set(count => count + 1);
  window.undo.push({ label: "Add Star", undo: () => count$.set(count => count - 1), redo: () => count$.set(count => count + 1) });
}
