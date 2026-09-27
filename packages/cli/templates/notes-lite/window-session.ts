import { fitFrame, type Frame, type SavedWindow } from "./session";
import type { NotesModel } from "./model";
export type WindowHost = {
  list(): Promise<{ id: string; frame: Frame }[]>;
  workAreas(): Promise<Frame[]>;
  open(window: SavedWindow): Promise<unknown>;
  show(id: string): Promise<unknown>;
  frame(id: string, frame: Frame): Promise<unknown>;
};
/** One controller per JS runtime; all React windows share its session and writer. */
export class WindowSession {
  private noteIds = new Map<string, string>();
  private restored?: Promise<void>;
  private quitting = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private notes: NotesModel, private host: WindowHost) {}
  known = (id: string) => id === "main" || id === "settings" || this.noteIds.has(id);
  async openNote(noteId: string) {
    await this.restore();
    const id = `note-${noteId}`;
    this.noteIds.set(id, noteId);
    if ((await this.host.list()).some(window => window.id === id)) await this.host.show(id);
    else await this.host.open({ id, noteId, frame: fitFrame({ displayId: "", x: 0, y: 0, width: 700, height: 600 }, await this.host.workAreas()) });
    await this.capture();
  }
  async openSettings() {
    await this.restore();
    if ((await this.host.list()).some(window => window.id === "settings")) await this.host.show("settings");
    else await this.host.open({ id: "settings", frame: fitFrame({ displayId: "", x: 0, y: 0, width: 460, height: 360 }, await this.host.workAreas()) });
    await this.capture();
  }
  capture = () => {
    const task = this.queue.then(async () => {
      if (this.quitting) return;
      const windows = await this.host.list();
      this.notes.setWindows(windows.filter(window => this.known(window.id)).map(window => ({ id: window.id, noteId: this.noteIds.get(window.id), frame: window.frame })));
    });
    this.queue = task.catch(() => {});
    return task;
  };
  restore = () => this.restored ??= (async () => {
    await this.notes.load();
    if (!this.notes.getSnapshot().ready) return;
    const saved = [...(this.notes.getSnapshot().windows ?? [])];
    const areas = await this.host.workAreas();
    for (const window of saved) {
      if (window.id !== "main" && window.id !== "settings" && !this.notes.getSnapshot().notes.some(note => note.id === window.noteId && !note.deleted)) continue;
      if (window.noteId) this.noteIds.set(window.id, window.noteId);
      const frame = fitFrame(window.frame, areas);
      if (window.id !== "main" && !(await this.host.list()).some(item => item.id === window.id)) await this.host.open({ ...window, frame });
      await this.host.frame(window.id, frame);
    }
    await this.capture();
  })();
  quit = async () => {
    await this.restore();
    await this.capture();
    const ok = await this.notes.flush();
    // Native quit may close windows individually. Keep their last complete session.
    if (ok) this.quitting = true;
    return ok;
  };
}
