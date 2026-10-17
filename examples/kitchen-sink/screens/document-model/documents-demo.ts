import { useEffect, useState, useSyncExternalStore } from "react";
import * as app from "@legendapp/spark/app";
import {
  addDocumentVersion, createDocumentSession, findDocumentSession, getDocumentSessionAvailability, getDocumentVersionsAvailability,
  listDocumentVersions, readDocumentVersionText, subscribeToOpenRequests, type DocumentSession, type DocumentVersion, type Subscription,
} from "@legendapp/spark/app/documents";
import type { Availability } from "@legendapp/spark/contracts";
import { showMessage } from "@legendapp/spark/dialogs";
import { exists, getDirectory, mkdir, readText, remove, writeText } from "@legendapp/spark/files";
import { showWindow } from "@legendapp/spark/windows";
import { errorText } from "../../Panel";
import type { DocumentsMessages } from "./documents-messages";

// The Documents screen's service. It owns a temporary folder, the document session bound to the main
// window (edited dot + proxy icon) and, after Duplicate, an untitled copy. A launch with RUN_FLAG runs every
// operation once on a fresh temp document and reports each check (e2e/flows/document-model/documents-*.yaml).
export const RUN_FLAG = "--ks-documents-run";
export const CHECKS = ["untitled", "edited", "saveAs", "save", "conflict", "external", "autosave", "duplicate", "rename", "moveTo", "revert", "versions", "locked", "reopen"] as const;
export type DocumentCheck = typeof CHECKS[number];
export type CheckResult = { passed: boolean; detail: string };
export type DemoState = {
  status: "loading" | "ready" | "unsupported" | "error";
  error?: string;
  availability: { session: Availability; versions: Availability };
  /** The typed error createDocumentSession throws where sessions are unavailable. */
  unsupportedCode?: string;
  session?: DocumentSession;
  duplicate?: DocumentSession;
  versions: readonly DocumentVersion[];
  checks: Partial<Record<DocumentCheck, CheckResult>>;
  running: boolean;
  result?: string;
  opened: readonly string[];
  focused: number;
};
const WINDOW = "main";
const AUTOSAVE = { delayMs: 800 };
const code = (error: unknown) => (error as { code?: string })?.code ?? errorText(error);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

class DocumentsDemo {
  private state: DemoState = { status: "loading", availability: { session: getDocumentSessionAvailability(), versions: getDocumentVersionsAvailability() }, versions: [], checks: {}, running: false, opened: [], focused: 0 };
  private readonly listeners = new Set<() => void>();
  private folder = "";
  private requests?: Subscription;
  private edits = 0;
  constructor(private readonly t: DocumentsMessages) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getState = () => this.state;
  private set(next: Partial<DemoState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private readonly report = (error: unknown) => this.set({ result: code(error) });
  private create(options: { windowId?: string; text?: string; untitledName?: (n: number) => string } = {}) {
    return createDocumentSession({ untitledName: this.t.untitled, onError: this.report, autosave: options.windowId ? AUTOSAVE : undefined, ...options });
  }
  private get session() { assert(this.state.session, "No document session"); return this.state.session; }
  private path() { const path = this.session.getState().path; assert(path, "The document is untitled"); return path; }

  async start() {
    if (!this.state.availability.session.available) {
      try { this.create(); } catch (error) { this.set({ status: "unsupported", unsupportedCode: code(error) }); return; }
    }
    try {
      this.folder = `${await getDirectory("temp")}/documents-demo-${Date.now()}`;
      await mkdir(this.folder);
      this.set({ session: this.create({ windowId: WINDOW, text: this.t.sample }), status: "ready" });
      this.requests = await subscribeToOpenRequests(request => { if (request.type === "file") void this.action(() => this.openRequested(request.path)); });
      if ((await app.getAppContext()).launchArguments.includes(RUN_FLAG)) await this.runAll();
    } catch (error) { this.set({ status: "error", error: errorText(error) }); }
  }
  async close() {
    this.requests?.remove();
    await this.state.duplicate?.remove();
    await this.state.session?.remove();
    if (this.folder) await remove(this.folder, { recursive: true });
  }
  // The session leaves the state before it is removed, so no control can reach it while removal (which awaits the
  // close-time autosave and the window update) runs. When removal or the next session fails, the window gets a new
  // untitled document and the error goes to the result line.
  private async replaceSession(next: () => DocumentSession | Promise<DocumentSession>) {
    const previous = this.state.session;
    this.set({ session: undefined, versions: [] });
    try {
      await previous?.remove();
      this.set({ session: await next() });
    } finally {
      if (!this.state.session) this.set({ session: this.create({ windowId: WINDOW }) });
    }
  }
  private async refreshVersions() {
    const path = this.session.getState().path;
    this.set({ versions: path && this.state.availability.versions.available ? await listDocumentVersions(path) : [] });
  }
  /** Runs one operation; the result line shows "ok", a save result or the error code. */
  async action(operation: () => Promise<string | void>) {
    try { this.set({ result: (await operation()) ?? "ok" }); }
    catch (error) { this.set({ result: code(error) }); }
    if (this.state.session) await this.refreshVersions().catch(this.report);
  }
  private async openRequested(path: string) {
    const open = findDocumentSession(path);
    if (open) {
      await showWindow(open.windowId ?? WINDOW, { focus: true });
      this.set({ focused: this.state.focused + 1 });
      return `focused ${open.windowId ?? WINDOW}`;
    }
    await this.replaceSession(async () => {
      const session = this.create({ windowId: WINDOW });
      try { await session.open(path); } catch (error) { await session.remove(); throw error; }
      return session;
    });
    this.set({ opened: [...this.state.opened, this.session.getState().name] });
    return `opened ${this.session.getState().name}`;
  }

  newDocument = () => this.action(() => this.replaceSession(() => this.create({ windowId: WINDOW })));
  edit = () => {
    try { const state = this.session.getState(); this.session.setText(`${state.text}Line ${++this.edits}\n`); }
    catch (error) { this.report(error); }
  };
  saveAs = () => this.action(() => this.session.saveAs(`${this.folder}/Document.txt`));
  save = (overwrite = false) => this.action(async () => { const result = await this.session.save({ overwrite }); return result.saved ? "saved" : result.reason; });
  duplicate = () => this.action(async () => {
    const copy = this.session.duplicate();
    await this.state.duplicate?.remove();
    this.set({ duplicate: this.create({ text: copy.text, untitledName: n => this.t.copyName(copy.name, n) }) });
  });
  rename = () => this.action(() => this.session.rename("Renamed.txt"));
  moveTo = () => this.action(async () => { await mkdir(`${this.folder}/Archive`); await this.session.moveTo(`${this.folder}/Archive`); });
  revert = () => this.action(() => this.session.revertToSaved());
  setLocked = (locked: boolean) => this.action(() => this.session.setLocked(locked));
  externalChange = () => this.action(() => writeText(this.path(), `Changed in another app (${++this.edits})\n`));
  addVersion = () => this.action(async () => { await addDocumentVersion(this.path()); });
  restore = (id: string) => this.action(() => this.session.restoreVersion(id));
  /** Autosave covers documents with a file; an edited untitled document asks Save / Don't Save / Cancel. */
  closeDocument = () => this.action(async () => {
    const state = this.session.getState();
    if (!state.path && state.edited) {
      const { close } = this.t;
      const { buttonId } = await showMessage({ title: close.title, message: close.message(state.name), kind: "warning", windowId: WINDOW, buttons: [{ id: "save", label: close.save }, { id: "discard", label: close.discard }, { id: "cancel", label: close.cancel }], defaultButtonId: "save", cancelButtonId: "cancel" });
      if (buttonId === "cancel" || buttonId === null) return "cancel";
      if (buttonId === "save") await this.session.saveAs(`${this.folder}/Document.txt`);
    }
    await this.replaceSession(() => this.create({ windowId: WINDOW }));
    return "closed";
  });

  /** Each check runs once, in order, on the main session; later checks build on earlier ones. */
  runAll = async () => {
    this.set({ running: true, checks: {} });
    const check = async (id: DocumentCheck, body: () => Promise<string>) => {
      let result: CheckResult;
      try { result = { passed: true, detail: await body() }; } catch (error) { result = { passed: false, detail: `${code(error)}: ${errorText(error)}` }; }
      this.set({ checks: { ...this.state.checks, [id]: result } });
    };
    const waitFor = async (condition: () => boolean | Promise<boolean>, what: string) => {
      for (const started = Date.now(); Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 50))) if (await condition()) return;
      throw new Error(`Timed out waiting for ${what}`);
    };
    const s = () => this.session;
    await this.replaceSession(() => this.create({ windowId: WINDOW }));
    const doc = `${this.folder}/Document.txt`;
    await check("untitled", async () => {
      const a = this.create(), b = this.create(), names = [a, b].map(session => session.getState().name);
      await a.remove();
      const c = this.create(), reused = c.getState().name;
      await Promise.all([b.remove(), c.remove()]);
      assert(reused === names[0] && names[1] !== names[0], `expected ${names[0]} to be reused, got ${reused}`);
      return `${s().getState().name}, ${names.join(", ")}; reused ${reused}`;
    });
    await check("edited", async () => { s().setText("First line\n"); assert(s().getState().edited, "not edited"); return "edited"; });
    await check("saveAs", async () => {
      await s().saveAs(doc);
      assert(await readText(doc) === "First line\n" && !s().getState().edited && s().getState().path === doc, "file or state mismatch");
      return s().getState().name;
    });
    await check("save", async () => {
      s().setText(`${s().getState().text}Second line\n`);
      const result = await s().save();
      assert(result.saved && await readText(doc) === s().getState().text && !s().getState().edited, "not saved");
      return "saved";
    });
    await check("conflict", async () => {
      s().setText(`${s().getState().text}Mine\n`);
      await writeText(doc, "Theirs\n");
      const first = await s().save();
      assert(!first.saved && s().getState().conflict && await readText(doc) === "Theirs\n", "the external change was overwritten");
      const second = await s().save({ overwrite: true });
      assert(second.saved && !s().getState().conflict && await readText(doc) === s().getState().text, "overwrite failed");
      return "conflict, then saved";
    });
    await check("external", async () => {
      await writeText(doc, "Changed in another app\n");
      await waitFor(() => s().getState().text === "Changed in another app\n", "the reload");
      assert(!s().getState().edited, "reloaded document is edited");
      return "reloaded";
    });
    await check("autosave", async () => {
      s().setText(`${s().getState().text}Autosaved line\n`);
      await waitFor(async () => !s().getState().edited && await readText(doc) === s().getState().text, "autosave");
      return `autosaved after ${AUTOSAVE.delayMs} ms`;
    });
    await check("duplicate", async () => {
      const copy = s().duplicate();
      await this.state.duplicate?.remove();
      const duplicate = this.create({ text: copy.text, untitledName: n => this.t.copyName(copy.name, n) });
      this.set({ duplicate });
      assert(duplicate.getState().name === this.t.copyName("Document", 1) && duplicate.getState().edited && duplicate.getState().text === s().getState().text, "duplicate mismatch");
      return duplicate.getState().name;
    });
    await check("rename", async () => {
      await s().rename("Renamed.txt");
      assert(s().getState().path === `${this.folder}/Renamed.txt` && await exists(`${this.folder}/Renamed.txt`) && !await exists(doc), "rename mismatch");
      return s().getState().name;
    });
    await check("moveTo", async () => {
      await mkdir(`${this.folder}/Archive`);
      await s().moveTo(`${this.folder}/Archive`);
      assert(s().getState().path === `${this.folder}/Archive/Renamed.txt` && await exists(this.path()), "move mismatch");
      return "Archive/Renamed.txt";
    });
    await check("revert", async () => {
      s().setText("Unwanted edit\n");
      await s().revertToSaved();
      assert(!s().getState().edited && s().getState().text === await readText(this.path()), "revert mismatch");
      return "reverted";
    });
    await check("versions", async () => {
      const added = await addDocumentVersion(this.path());
      const versions = await listDocumentVersions(this.path());
      assert(versions.length >= 3 && versions[0]!.id === added.id, `expected the added version first among saved versions, found ${versions.length}`);
      const oldest = versions.at(-1)!, contents = await readDocumentVersionText(this.path(), oldest.id);
      await s().restoreVersion(oldest.id);
      assert(s().getState().text === contents && (await listDocumentVersions(this.path())).length === versions.length + 1, "restore mismatch");
      await this.refreshVersions();
      return `${versions.length} versions; restored “${contents.trim()}”`;
    });
    await check("locked", async () => {
      await s().setLocked(true);
      try {
        assert(s().getState().locked && s().getState().readOnly, "not locked");
        s().setText(`${s().getState().text}Blocked\n`);
        const refused = await s().save().then(() => "saved", code);
        assert(refused === "E_READ_ONLY", `expected E_READ_ONLY, got ${refused}`);
      } finally { await s().setLocked(false); }
      assert((await s().save()).saved, "unlocked save failed");
      return "E_READ_ONLY, then saved";
    });
    await check("reopen", async () => {
      const before = this.state.focused, result = await this.openRequested(this.path());
      assert(this.state.focused === before + 1, "the open document was not focused");
      return result;
    });
    this.set({ running: false });
  };
}

// One demo at a time: a remount waits for the previous session and folder to be released.
let previous: Promise<unknown> = Promise.resolve();
const IDLE: DemoState = { status: "loading", availability: { session: { available: false, reason: "missing-module" }, versions: { available: false, reason: "missing-module" } }, versions: [], checks: {}, running: false, opened: [], focused: 0 };
const idle = { subscribe: () => () => {}, getState: () => IDLE };
function useDemoLifetime(t: DocumentsMessages): DocumentsDemo | null {
  const [demo, setDemo] = useState<DocumentsDemo | null>(null);
  useEffect(() => {
    const current = new DocumentsDemo(t);
    let end!: () => void;
    const ended = new Promise<void>(resolve => { end = resolve; });
    previous = previous.then(() => current.start()).then(() => ended).then(() => current.close()).catch(error => { console.error("Documents demo cleanup failed", error); });
    setDemo(current);
    return end;
  }, [t]);
  return demo;
}
export function useDocumentsDemo(t: DocumentsMessages) {
  const demo = useDemoLifetime(t);
  const state = useSyncExternalStore((demo ?? idle).subscribe, (demo ?? idle).getState);
  return { state, demo };
}
