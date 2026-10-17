import { move, readText, writeText, writeTextIfUnchanged } from "@legendapp/spark-file-system";
import { absolute, featureAvailability, requireFeature } from "@legendapp/spark-file-system/src/native";
import { setWindowOptions } from "@legendapp/spark-desktop-windows/src/api";
import { SparkError, asyncRegistration, type AsyncRegistration, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { watchDocumentReload } from "./reload";
import { addDocumentVersion, documentFileState, getDocumentVersionsAvailability, restoreDocumentVersion, setDocumentFileLocked } from "./versions";

/** Options for `createDocumentSession`. Unknown keys throw E_UNSUPPORTED_OPTION; `autosave.delayMs` is in milliseconds. */
export interface DocumentSessionOptions {
  /** Localized name of untitled document number n (1, 2, …). The lowest free number is used; removal frees it. */
  untitledName: (number: number) => string;
  /** Initial contents of the untitled document, such as a duplicate's. Nonempty text starts edited. */
  text?: string;
  /** This window's edited dot (macos.documentEdited) and proxy icon (macos.representedUri) follow the session. */
  windowId?: string;
  /** Autosave in place: delayMs after the last edit, a document with a path is written with the same conflict check as save(). */
  autosave?: { delayMs: number };
  /** Background failures: autosave, external-change reloads and window updates. */
  onError: (error: unknown) => void;
}
/** Snapshot of a `DocumentSession`, returned by `getState()` and `useDocumentSessionState`. */
export interface DocumentState {
  /** null while untitled. */
  path: string | null;
  /** File name, or the untitled name. */
  name: string;
  text: string;
  /** text differs from what is on disk (for an untitled document: is not empty). */
  edited: boolean;
  /** Finder's Locked flag. */
  locked: boolean;
  /** The file cannot be replaced: locked, no write permission on it or its folder, or a read-only volume. */
  readOnly: boolean;
  /** The file changed on disk while there were unsaved edits, or a save found it changed. Resolve with revertToSaved() or save({ overwrite: true }). */
  conflict: boolean;
}
/** Result of `DocumentSession.save()`: saved, or not saved because the file changed on disk since it was read. */
export type DocumentSaveResult = { saved: true } | { saved: false; reason: "conflict" };
/** Options for `DocumentSession.save()`. */
export interface DocumentSaveOptions { /** Replace the file even if it changed since it was read. */ overwrite?: boolean }
/**
 * One document: its contents, file and window. Operations run one at a time in call order. remove() stops
 * listeners, awaits accepted work, writes pending edits when autosave is on, stops watching and clears the window's
 * edited dot and proxy icon.
 */
export interface DocumentSession extends AsyncRegistration {
  readonly windowId: string | undefined;
  getState(): DocumentState;
  subscribe(listener: () => void): Subscription;
  setText(text: string): void;
  /** Reads a file into this session. Rejects E_BUSY when this session has unsaved edits or another session has the file open. */
  open(path: string): Promise<void>;
  /** Writes in place when the file is unchanged since it was read or saved; otherwise resolves { saved: false, reason: "conflict" }. Records a version (macOS). Untitled documents reject E_INVALID_ARGUMENT: use saveAs. */
  save(options?: DocumentSaveOptions): Promise<DocumentSaveResult>;
  /** Writes to path (replacing it: confirm with the save panel first) and continues there. */
  saveAs(path: string): Promise<void>;
  /** Contents (with unsaved edits) and the base name for a new untitled session, as File › Duplicate does. */
  duplicate(): { text: string; name: string };
  /** Renames the file in its folder. An existing name rejects E_ALREADY_EXISTS. */
  rename(name: string): Promise<void>;
  /** Moves the file into directory, keeping its name. */
  moveTo(directory: string): Promise<void>;
  /** Discards unsaved edits and conflicts by reading the file again. */
  revertToSaved(): Promise<void>;
  /** Replaces the file with a saved version (see listDocumentVersions); the replaced contents become a version. Rejects E_BUSY with unsaved edits. */
  restoreVersion(versionId: string): Promise<void>;
  setLocked(locked: boolean): Promise<void>;
}

/** Sessions need coordinated file access: macOS. Windows: unsupported-platform (LegendApp/legend-spark#280). */
export function getDocumentSessionAvailability(): Availability { return featureAvailability("coordination"); }

const sessions = new Set<{ session: DocumentSession; path(): string | null }>();
const untitled = new Map<string, Set<number>>();
/** The live session that has path open, so reopening it can focus session.windowId instead of opening it twice. */
export function findDocumentSession(path: string): DocumentSession | undefined {
  const target = normalize(path);
  for (const entry of sessions) if (entry.path() === target) return entry.session;
}

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of absolute(path).split("/")) {
    if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}
const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const fileURL = (path: string) => "file://" + path.split("/").map(encodeURIComponent).join("/");
const coordinated = { coordinated: true } as const;
const closed = () => new SparkError("E_CLOSED", "Document session was removed");
function fileName(name: unknown) {
  if (typeof name !== "string" || !name || name === "." || name === ".." || /[/\0]/.test(name) || new TextEncoder().encode(name).length > 255) {
    throw new SparkError("E_INVALID_ARGUMENT", "Expected a file name without slashes");
  }
  return name;
}
// A version is a safety net: volumes without a revision store still save, as NSDocument does there.
async function recordVersion(path: string) {
  if (!getDocumentVersionsAvailability().available) return;
  try { await addDocumentVersion(path); }
  catch (error) { if (!(error instanceof SparkError && error.code === "E_UNAVAILABLE")) throw error; }
}

/** Creates an untitled document session (see `DocumentSession`). macOS only: throws E_UNSUPPORTED_PLATFORM elsewhere (see `getDocumentSessionAvailability`). Invalid options throw E_INVALID_ARGUMENT, unknown keys E_UNSUPPORTED_OPTION. */
export function createDocumentSession(options: DocumentSessionOptions): DocumentSession {
  if (!options || typeof options !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected document session options");
  for (const key of Object.keys(options)) if (!["untitledName", "text", "windowId", "autosave", "onError"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown document session option: ${key}`);
  const { untitledName, windowId, autosave, onError } = options, text = options.text ?? "";
  if (typeof untitledName !== "function" || typeof onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected untitledName and onError functions");
  if (typeof text !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected text");
  if (windowId !== undefined && (typeof windowId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Expected a window id");
  if (autosave !== undefined && (!autosave || typeof autosave !== "object" || Object.keys(autosave).some(key => key !== "delayMs")
    || !Number.isFinite(autosave.delayMs) || autosave.delayMs < 0 || autosave.delayMs > 2147483647)) throw new SparkError("E_INVALID_ARGUMENT", "autosave must be { delayMs } with a nonnegative delay");
  requireFeature("coordination", "Document sessions");

  const family = untitledName(1);
  const taken = untitled.get(family) ?? new Set<number>();
  let number = 1;
  while (taken.has(number)) number++;
  const name = number === 1 ? family : untitledName(number);
  if (typeof name !== "string" || !name) throw new SparkError("E_INVALID_ARGUMENT", "untitledName must return a nonempty name");
  taken.add(number); untitled.set(family, taken);
  const releaseUntitled = () => { if (taken.delete(number) && !taken.size) untitled.delete(family); };

  let state: DocumentState = { path: null, name, text, edited: text !== "", locked: false, readOnly: false, conflict: false };
  let saved = "", active = true, preserved = false, timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve(), watching: AsyncRegistration | undefined;
  const listeners = new Set<() => void>();
  // The window shows the latest state; updates are coalesced and applied in order.
  let shown = { edited: false, uri: null as string | null }, wanted = shown, showing: Promise<void> | undefined;
  const show = (): Promise<void> => showing ??= (async () => {
    await null;
    while (wanted !== shown) {
      const next = wanted;
      try { await setWindowOptions(windowId!, { macos: { documentEdited: next.edited, representedUri: next.uri } }); }
      catch (error) { onError(error); }
      shown = next;
    }
  })().finally(() => { showing = undefined; if (wanted !== shown) void show(); });
  const update = (next: Partial<DocumentState>) => {
    state = { ...state, ...next };
    state.edited = state.text !== saved;
    if (windowId) {
      const uri = state.path && fileURL(state.path);
      if (wanted.edited !== state.edited || wanted.uri !== uri) { wanted = { edited: state.edited, uri }; void show(); }
    }
    if (active) for (const listener of listeners) listener();
  };
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => active ? run(() => active ? operation() : Promise.reject(closed())) : Promise.reject(closed());
  const requirePath = () => {
    if (!state.path) throw new SparkError("E_INVALID_ARGUMENT", "The document is untitled; save it with saveAs first");
    return state.path;
  };
  const fileState = async (path: string) => { const { locked, writable } = await documentFileState(path); return { locked, readOnly: !writable }; };
  const check = async () => {
    const path = state.path;
    if (!path) return;
    const disk = await readText(path, coordinated);
    if (disk === saved) return;
    if (state.edited) update({ conflict: true });
    else { saved = disk; update({ text: disk, conflict: false }); }
  };
  const watch = async (path: string | null) => {
    const previous = watching; watching = undefined;
    await previous?.remove();
    if (!path || !active) return;
    // Never return the queued check: watch removal awaits a running onReload.
    watching = await watchDocumentReload({ path, onError, onReload: () => { void enqueue(check).catch(error => { if (active) onError(error); }); } });
  };
  const write = async (overwrite: boolean): Promise<DocumentSaveResult> => {
    const path = requirePath(), snapshot = state.text;
    const current = await fileState(path);
    if (current.readOnly) { update(current); throw new SparkError("E_READ_ONLY", current.locked ? "The document is locked" : "The document cannot be written"); }
    // Like NSDocument, keep the contents as they were before this session's first write.
    if (!preserved) { await recordVersion(path); preserved = true; }
    if (overwrite) await writeText(path, snapshot, coordinated);
    else if (!(await writeTextIfUnchanged(path, saved, snapshot, coordinated)).written) { update({ conflict: true }); return { saved: false, reason: "conflict" }; }
    saved = snapshot; update({ conflict: false });
    return { saved: true };
  };
  const autosaveNow = async () => {
    if (state.path && state.edited && !state.conflict && !state.readOnly) await write(false);
  };
  const relocate = async (to: string) => {
    const from = requirePath();
    if (to === from) return;
    if (state.locked) throw new SparkError("E_READ_ONLY", "The document is locked");
    await move(from, to, coordinated);
    update({ path: to, name: baseName(to) });
    await watch(to);
  };
  const reread = async (path: string) => {
    clearTimeout(timer);
    const disk = await readText(path, coordinated);
    saved = disk; update({ text: disk, conflict: false, ...await fileState(path) });
  };

  const registration = asyncRegistration(() => {
    active = false; clearTimeout(timer); listeners.clear(); releaseUntitled(); sessions.delete(entry);
  }, async () => {
    await run(async () => {
      try { if (autosave) await autosaveNow(); }
      finally {
        await watch(null);
        if (windowId) { wanted = { edited: false, uri: null }; while (wanted !== shown) await show(); }
      }
    });
  });
  const session: DocumentSession = {
    windowId,
    getState: () => state,
    subscribe(listener) {
      if (!active) throw closed();
      listeners.add(listener); return { remove() { listeners.delete(listener); } };
    },
    setText(value) {
      if (!active) throw closed();
      if (typeof value !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected text");
      update({ text: value });
      if (autosave && state.path && state.edited) {
        clearTimeout(timer);
        timer = setTimeout(() => { void enqueue(autosaveNow).catch(error => { if (active) onError(error); }); }, autosave.delayMs);
      }
    },
    open: path => enqueue(async () => {
      const target = normalize(path);
      if (state.edited) throw new SparkError("E_BUSY", "The document has unsaved edits");
      const owner = findDocumentSession(target);
      if (owner && owner !== session) throw new SparkError("E_BUSY", `The document is already open${owner.windowId ? ` in window ${owner.windowId}` : ""}`);
      const disk = await readText(target, coordinated), file = await fileState(target);
      saved = disk; preserved = false; releaseUntitled();
      update({ path: target, name: baseName(target), text: disk, conflict: false, ...file });
      await watch(target);
    }),
    save: (saveOptions = {}) => enqueue(async () => {
      if (!saveOptions || typeof saveOptions !== "object" || Object.keys(saveOptions).some(key => key !== "overwrite")) throw new SparkError("E_UNSUPPORTED_OPTION", "save accepts only overwrite");
      if (saveOptions.overwrite !== undefined && typeof saveOptions.overwrite !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "overwrite must be a boolean");
      clearTimeout(timer);
      const result = await write(saveOptions.overwrite ?? false);
      if (result.saved) await recordVersion(state.path!);
      return result;
    }),
    saveAs: path => enqueue(async () => {
      const target = normalize(path);
      const owner = findDocumentSession(target);
      if (owner && owner !== session) throw new SparkError("E_BUSY", "Another session has that document open");
      clearTimeout(timer);
      const snapshot = state.text;
      await writeText(target, snapshot, coordinated);
      saved = snapshot; preserved = true; releaseUntitled();
      update({ path: target, name: baseName(target), conflict: false, ...await fileState(target) });
      await watch(target);
      await recordVersion(target);
    }),
    duplicate() {
      if (!active) throw closed();
      return { text: state.text, name: state.path ? state.name.replace(/(.)\.[^.]+$/, "$1") : state.name };
    },
    rename: newName => enqueue(async () => { const path = requirePath(); await relocate(`${parent(path)}/${fileName(newName)}`.replace(/^\/\//, "/")); }),
    moveTo: directory => enqueue(async () => { const path = requirePath(); await relocate(`${normalize(directory)}/${baseName(path)}`.replace(/^\/\//, "/")); }),
    revertToSaved: () => enqueue(async () => { await reread(requirePath()); }),
    restoreVersion: versionId => enqueue(async () => {
      const path = requirePath();
      if (state.edited) throw new SparkError("E_BUSY", "Save or revert unsaved edits before restoring a version");
      await restoreDocumentVersion(path, versionId);
      await reread(path);
    }),
    setLocked: locked => enqueue(async () => {
      if (typeof locked !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "locked must be a boolean");
      const path = requirePath();
      await setDocumentFileLocked(path, locked);
      update(await fileState(path));
    }),
    remove: registration.remove,
  };
  const entry = { session, path: () => state.path };
  sessions.add(entry);
  update({});
  return session;
}
