import { createRequire } from "node:module";
import React, { act, useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// The Documents screen against fake sessions whose remove() resolves only when the test says so: the sandbox
// variant's slower removal let a tap reach a removed session (LegendApp/legend-spark#490).
type Fake = { name: string; text: string; path: string | null; active: boolean; removal?: () => void; removed: Promise<void> };
const fakes = vi.hoisted(() => ({ all: [] as Fake[], hold: false }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("../examples/kitchen-sink/shell/app-controller", () => ({ useI18n: () => ({ locale: "en" }) }));
vi.mock("@legendapp/spark/ui/uniwind", () => ({ Button: (props: object) => React.createElement("Button", props) }));
vi.mock("@legendapp/spark/app", () => ({ getAppContext: async () => ({ launchArguments: [] }) }));
vi.mock("@legendapp/spark/dialogs", () => ({ showMessage: vi.fn(async () => ({ buttonId: "discard" })) }));
vi.mock("@legendapp/spark/windows", () => ({ showWindow: vi.fn(async () => {}) }));
vi.mock("@legendapp/spark/files", () => ({ getDirectory: async () => "/tmp", mkdir: async () => {}, remove: async () => {}, exists: async () => false, readText: async () => "", writeText: async () => {} }));
vi.mock("@legendapp/spark/app/documents", () => {
  const closed = () => Object.assign(new Error("Document session was removed"), { code: "E_CLOSED" });
  const createDocumentSession = (options: { untitledName: (n: number) => string; text?: string; windowId?: string }) => {
    const fake: Fake = { name: options.untitledName(fakes.all.filter(entry => entry.active).length + 1), text: options.text ?? "", path: null, active: true, removed: Promise.resolve() };
    fakes.all.push(fake);
    const listeners = new Set<() => void>();
    let snapshot = {};
    const state = () => snapshot;
    const changed = () => { snapshot = { path: fake.path, name: fake.name, text: fake.text, edited: fake.text !== "", locked: false, readOnly: false, conflict: false }; for (const listener of listeners) listener(); };
    changed();
    const session = {
      windowId: options.windowId,
      getState: state,
      subscribe(listener: () => void) { if (!fake.active) throw closed(); listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
      setText(text: string) { if (!fake.active) throw closed(); fake.text = text; changed(); },
      remove() {
        if (fake.active) { fake.active = false; listeners.clear(); fake.removed = fakes.hold ? new Promise<void>(resolve => { fake.removal = resolve; }) : Promise.resolve(); }
        return fake.removed;
      },
    };
    return session;
  };
  return {
    createDocumentSession, findDocumentSession: () => undefined, listDocumentVersions: async () => [], addDocumentVersion: async () => ({}),
    getDocumentSessionAvailability: () => ({ available: true }), getDocumentVersionsAvailability: () => ({ available: true }),
    subscribeToOpenRequests: async () => ({ remove() {} }),
    useDocumentSessionState: (session: { subscribe(listener: () => void): { remove(): void }; getState(): object }) => useSyncExternalStore(listener => {
      try { const subscription = session.subscribe(listener); return () => subscription.remove(); } catch { return () => {}; }
    }, session.getState),
  };
});
const { Documents } = await import("../examples/kitchen-sink/screens/document-model/Documents");

const ID = "document-model-documents";
let rendered: any;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; fakes.all.length = 0; fakes.hold = false; });
afterEach(async () => { fakes.hold = false; for (const fake of fakes.all) fake.removal?.(); if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; }); });
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const find = (testID: string) => rendered.root.findAll((node: any) => node.props.testID === testID && typeof node.type === "string");
const press = (testID: string) => act(async () => { find(testID)[0].props.onPress(); });

test("while New removes the document, no control reaches it; Edit then edits the new document", async () => {
  await act(async () => { rendered = create(React.createElement(Documents)); });
  await settle();
  expect(find(`${ID}-edited`)).toHaveLength(1);
  fakes.hold = true;
  await press(`${ID}-new`);
  const [first, second] = fakes.all;
  expect(first!.active).toBe(false);
  expect(second).toBeUndefined();
  // The removed session is out of the screen: no Edit, Close or document flags to tap or assert.
  expect([`${ID}-edit`, `${ID}-close`, `${ID}-edited`].map(id => find(id).length)).toEqual([0, 0, 0]);
  await act(async () => { first!.removal!(); });
  await settle();
  expect(fakes.all[1]!.active).toBe(true);
  expect(find(`${ID}-saved`)).toHaveLength(1);
  await press(`${ID}-edit`);
  expect(fakes.all[1]!.text).toBe("Line 1\n");
  expect(find(`${ID}-edited`)).toHaveLength(1);
});

test("Close replaces an edited document with a new untitled one and reports closed", async () => {
  await act(async () => { rendered = create(React.createElement(Documents)); });
  await settle();
  await press(`${ID}-close`);
  await settle();
  expect(fakes.all.map(fake => fake.active)).toEqual([false, true]);
  expect(find(`${ID}-result`)[0].props.children).toBe("Last result: closed");
  expect(find(`${ID}-saved`)).toHaveLength(1);
});
