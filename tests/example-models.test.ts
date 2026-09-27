import { describe, expect, test } from "vitest";
import { Records } from "../packages/cli/templates/example-shared/records.ts";
import { NotesModel, decodeNotebook } from "../packages/cli/templates/notes-lite/model.ts";
function memory() { const map = new Map<string, string>(); return { map, getItem: async (key: string) => map.get(key) ?? null, setItem: async (key: string, value: string) => { map.set(key, value); } }; }
describe("example persistence", () => {
  test("recovers a preceding snapshot without discarding corrupt data", async () => {
    const storage = memory(); const records = new Records(storage, "notes", decodeNotebook); await records.load();
    const first = { version: 1 as const, notes: [], selectedId: null }; await records.save(first); await records.save(first);
    storage.map.set("notes:0", "broken");
    expect(await new Records(storage, "notes", decodeNotebook).load()).toEqual({ value: first, recovered: true });
    expect(storage.map.get("notes:0")).toBe("broken");
  });
  test("unreadable storage does not become an empty notebook", async () => {
    const storage = memory(); storage.map.set("notes:1", "broken");
    const model = new NotesModel(new Records(storage, "notes", decodeNotebook)); await model.load(); model.create("must not overwrite");
    expect(model.getSnapshot().ready).toBe(false); expect(await model.flush()).toBe(false); expect(storage.map.get("notes:1")).toBe("broken");
  });
  test("autosave retains edits made while an earlier snapshot is being saved", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const snapshots: any[] = [];
    const model = new NotesModel({ load: async () => ({ value: null, recovered: false }), save: async value => { snapshots.push(value); if (snapshots.length === 1) await gate; } });
    await model.load(); model.create("first"); const id = model.getSnapshot().selectedId!;
    const saving = model.flush(); model.edit(id, "second"); release(); expect(await saving).toBe(true);
    expect(snapshots.at(-1).notes[0].text).toBe("second"); expect(model.getSnapshot().dirty).toBe(false);
  });
  test("failed saves remain dirty and can be retried", async () => {
    let fail = true; const model = new NotesModel({ load: async () => ({ value: null, recovered: false }), save: async () => { if (fail) throw Error("disk full"); } });
    await model.load(); model.create("keep me"); expect(await model.flush()).toBe(false); expect(model.getSnapshot().dirty).toBe(true);
    fail = false; expect(await model.flush()).toBe(true); expect(model.getSnapshot().dirty).toBe(false);
  });
  test("delete and restore survive reopening", async () => {
    const storage = memory(); const model = new NotesModel(new Records(storage, "notes", decodeNotebook)); await model.load(); model.create("recover me");
    const id = model.getSnapshot().selectedId!; model.setDeleted(id, true); await model.flush();
    const reopened = new NotesModel(new Records(storage, "notes", decodeNotebook)); await reopened.load(); expect(reopened.getSnapshot().notes[0]?.deleted).toBe(true);
    reopened.setDeleted(id, false); await reopened.flush(); expect(reopened.getSnapshot().notes[0]?.text).toBe("recover me");
  });
});

import { mountSerial } from '../packages/cli/templates/example-shared/lifetime.ts';
test('Strict Mode remount waits for asynchronous guard teardown', async () => {
  const calls: string[] = []; let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = mountSerial('test-window', async retain => { calls.push('first'); await retain(Promise.resolve({ remove: async () => { calls.push('remove-first'); await gate; } })); }, message => { throw Error(message); });
  await new Promise(resolve => setTimeout(resolve, 0)); first();
  const second = mountSerial('test-window', async () => { calls.push('second'); }, message => { throw Error(message); });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(calls).toEqual(['first','remove-first']); finish();
  await new Promise(resolve => setTimeout(resolve, 0)); expect(calls).toEqual(['first','remove-first','second']); second();
});

test('a newer application schema is preserved for migration instead of silently rolled back', async () => {
  const storage = memory();
  const writer = new Records<unknown>(storage, 'future', value => value); await writer.load();
  await writer.save({ version: 1, notes: [], selectedId: null });
  await writer.save({ version: 2, notes: [], selectedId: null });
  await expect(new Records(storage, 'future', decodeNotebook).load()).rejects.toThrow('Unsupported');
});

import { fitFrame } from '../packages/cli/templates/notes-lite/session.ts';
test('old notebooks load with system theme and no restored windows', () => {
  const notebook = decodeNotebook({ version: 1, notes: [], selectedId: null });
  expect(notebook.theme ?? 'system').toBe('system');
  expect(notebook.windows ?? []).toEqual([]);
});
test('theme and open windows survive a notebook restart', async () => {
  const storage = memory();
  const model = new NotesModel(new Records(storage, 'settings-session', decodeNotebook));
  await model.load(); model.create('window note'); const id = model.getSnapshot().selectedId!;
  model.setTheme('dark');
  model.setWindows([{ id: `note-${id}`, noteId: id, frame: { displayId: "primary", x: -1200, y: 50, width: 700, height: 600 } }]);
  expect(await model.flush()).toBe(true);
  const reopened = new NotesModel(new Records(storage, 'settings-session', decodeNotebook)); await reopened.load();
  expect(reopened.getSnapshot().theme).toBe('dark');
  expect(reopened.getSnapshot().windows).toEqual(model.getSnapshot().windows);
  expect(reopened.getSnapshot().notes[0]?.text).toBe('window note');
});
test('disconnected and smaller displays keep restored windows inside the work area', () => {
  expect(fitFrame({ displayId: "primary", x: -1200, y: 100, width: 700, height: 600 }, [{ displayId: "primary", x: 0, y: 24, width: 1000, height: 700 }])).toEqual({ displayId: "primary", x: 0, y: 100, width: 700, height: 600 });
  expect(fitFrame({ displayId: "primary", x: 900, y: 900, width: 1400, height: 1000 }, [{ displayId: "primary", x: 0, y: 24, width: 1000, height: 700 }])).toEqual({ displayId: "primary", x: 0, y: 24, width: 1000, height: 700 });
  const frame = { displayId: "secondary", x: 100, y: 50, width: 700, height: 600 };
  expect(fitFrame(frame, [{ displayId: "primary", x: 0, y: 0, width: 1200, height: 800 }, { displayId: "secondary", x: 0, y: 0, width: 1200, height: 800 }])).toEqual(frame);
});
test('multiple views receive edits and deletion without clearing another selected note', async () => {
  const model = new NotesModel({ load: async () => ({ value: null, recovered: false }), save: async () => {} });
  await model.load(); const first = model.create('first')!; const second = model.create('second')!;
  const views: string[][] = [[], []];
  const off = views.map(view => model.subscribe(() => { const note = model.getSnapshot().notes.find(note => note.id === first)!; view.push(`${note.text}:${note.deleted}`); }));
  model.edit(first, 'edited'); model.setDeleted(first, true);
  expect(model.getSnapshot().selectedId).toBe(second);
  expect(views[0]).toEqual(['edited:false', 'edited:true']); expect(views[1]).toEqual(views[0]);
  off.forEach(remove => remove()); await model.flush();
});
test('concurrent close and quit wait for the newest edit and both veto failed saves', async () => {
  let release!: () => void; let fail = true; const written: string[] = [];
  const gate = new Promise<void>(resolve => { release = resolve; });
  const model = new NotesModel({ load: async () => ({ value: null, recovered: false }), save: async value => { await gate; if (fail) throw Error('disk full'); written.push(value.notes[0]!.text); } });
  await model.load(); const id = model.create('before close')!;
  const close = model.flush(); const quit = model.flush(); model.edit(id, 'last edit'); release();
  expect(await close).toBe(false); expect(await quit).toBe(false); expect(model.getSnapshot().dirty).toBe(true);
  fail = false; expect(await model.flush()).toBe(true); expect(written.at(-1)).toBe('last edit');
});
test('window session validation rejects duplicate IDs and nonfinite geometry', () => {
  const frame = { displayId: "primary", x: 0, y: 0, width: 700, height: 600 };
  expect(() => decodeNotebook({ version: 1, notes: [], selectedId: null, windows: [{ id: 'main', frame }, { id: 'main', frame }] })).toThrow('window session');
  expect(() => decodeNotebook({ version: 1, notes: [], selectedId: null, windows: [{ id: 'main', frame: { ...frame, x: Infinity } }] })).toThrow('window session');
});

import { WindowSession, type WindowHost } from '../packages/cli/templates/notes-lite/window-session.ts';
test('restoration is idempotent, skips deleted notes, and quit retains open windows', async () => {
  const frame = { displayId: "primary", x: 1800, y: 20, width: 700, height: 600 };
  const model = new NotesModel({ load: async () => ({ recovered: false, value: { version: 1, selectedId: 'live', notes: [{ id: 'live', text: 'hello', updatedAt: 0, deleted: false }, { id: 'gone', text: 'deleted', updatedAt: 0, deleted: true }], windows: [{ id: 'main', frame }, { id: 'note-live', noteId: 'live', frame }, { id: 'note-gone', noteId: 'gone', frame }, { id: 'settings', frame }] } }), save: async () => {} });
  const native = new Map([['main', { id: 'main', frame }]]); const opened: string[] = [];
  const host: WindowHost = { list: async () => [...native.values()], workAreas: async () => [{ displayId: "primary", x: 0, y: 0, width: 1200, height: 800 }], open: async window => { opened.push(window.id); native.set(window.id, window); }, show: async () => {}, frame: async (id, frame) => { native.get(id)!.frame = frame; } };
  const session = new WindowSession(model, host);
  await Promise.all([session.restore(), session.restore()]); expect(opened).toEqual(['note-live', 'settings']);
  expect(native.get('main')!.frame.x).toBe(500);
  await session.openNote('live'); expect(opened).toEqual(['note-live', 'settings']);
  native.delete('settings'); await session.capture(); expect(model.getSnapshot().windows?.map(window => window.id)).toEqual(['main', 'note-live']);
  expect(await session.quit()).toBe(true);
  native.clear(); await session.capture(); expect(model.getSnapshot().windows?.map(window => window.id)).toEqual(['main', 'note-live']);
});
test('failed quit keeps session tracking active and succeeds after retry', async () => {
  let fail = true;
  const model = new NotesModel({ load: async () => ({ recovered: false, value: null }), save: async () => { if (fail) throw Error('disk full'); } });
  let windows = [{ id: 'main', frame: { displayId: "primary", x: 0, y: 0, width: 700, height: 600 } }];
  const session = new WindowSession(model, { list: async () => windows, workAreas: async () => [], open: async () => {}, show: async () => {}, frame: async () => {} });
  await session.restore(); expect(await session.quit()).toBe(false);
  windows = [{ ...windows[0]!, frame: { ...windows[0]!.frame, x: 100 } }]; await session.capture();
  expect(model.getSnapshot().windows?.[0]?.frame.x).toBe(100);
  fail = false; expect(await session.quit()).toBe(true);
});
