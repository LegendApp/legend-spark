import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import type { UndoEntry, UndoStack, UndoState } from "./types";

const LIMIT = 100;
export function createUndoStack(): UndoStack {
  const done: UndoEntry[] = [], undone: UndoEntry[] = [], listeners = new Set<(state: UndoState) => void>();
  const label = (entry: UndoEntry | undefined) => entry?.label ?? null;
  const snapshot = (): UndoState => Object.freeze({ canUndo: done.length > 0, canRedo: undone.length > 0, undoLabel: label(done.at(-1)), redoLabel: label(undone.at(-1)) });
  let state = snapshot();
  const changed = () => { state = snapshot(); for (const listener of [...listeners]) listener(state); };
  const move = (from: UndoEntry[], to: UndoEntry[], apply: "undo" | "redo") => {
    const entry = from.at(-1);
    if (!entry) return false;
    entry[apply]();
    from.pop(); to.push(entry); changed(); return true;
  };
  return {
    push(entry) {
      if (!entry || typeof entry.undo !== "function" || typeof entry.redo !== "function" || (entry.label !== undefined && typeof entry.label !== "string")) throw new SparkError("E_INVALID_ARGUMENT", "Undo entries need undo and redo functions");
      done.push({ label: entry.label, undo: entry.undo, redo: entry.redo });
      if (done.length > LIMIT) done.shift();
      undone.length = 0; changed();
    },
    undo: () => move(done, undone, "undo"),
    redo: () => move(undone, done, "redo"),
    clear() { if (done.length || undone.length) { done.length = 0; undone.length = 0; changed(); } },
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected an undo listener");
      listeners.add(listener); return { remove() { listeners.delete(listener); } };
    },
  };
}
