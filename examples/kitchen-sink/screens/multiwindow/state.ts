import { observable } from "@legendapp/state";
import { createWindowMessages, createWindowState, type WindowErrorEvent, type WindowInstance } from "@legendapp/spark/windows";

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

/**
 * What a note window shows, restored by window sessions and copied by New Window: its route, scroll
 * offset, selected item and sidebar width.
 */
export type NoteView = { route: "document" | "details"; scrollY: number; selected: number | null; split: number };
export const noteViews = createWindowState<NoteView>({ initial: () => ({ route: "document", scrollY: 0, selected: null, split: 160 }), restorationKey: "ks-note-view" });
/** The last broadcast a note window heard. Not restorable: a session starts without it. */
export const highlights = createWindowState<{ word: string; from: string } | null>({ initial: () => null });

/** Typed messages between the main window and note windows. */
export type NoteSummary = NoteView & { title: string; stars: number };
export const noteMessages = createWindowMessages<{ summary(payload: null): NoteSummary }, { highlight: { word: string } }>();

/** Note windows are numbered by title ("Note 3" is note 3); window ID → title. */
export const noteTitles = new Map<string, string>();
let notes = 0;
export const nextNoteTitle = () => `Note ${++notes}`;
export const noteNumber = (title: string) => /(\d+)$/.exec(title)?.[1] ?? title;
/**
 * Tracks a note window opened from the main window, a session or New Window: it answers `summary`
 * requests and shows the last `highlight` broadcast. Its handler and listener end when it closes.
 */
export function adoptNote(window: WindowInstance, title: string) {
  if (noteTitles.has(window.id)) return;
  noteTitles.set(window.id, title);
  notes = Math.max(notes, Number(noteNumber(title)) || 0);
  noteMessages.handle(window, "summary", () => ({ ...noteViews.get(window).peek(), title, stars: stars.get(window).count.peek() }));
  noteMessages.addListener("highlight", ({ word }, from) => highlights.get(window).set({ word, from: from ? noteTitles.get(from.id) ?? from.id : "main" }), { window });
}
