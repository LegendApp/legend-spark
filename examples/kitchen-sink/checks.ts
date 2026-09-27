import * as documents from "@legendapp/spark/app/documents";
import { toByteArray } from "base64-js";
import { fileConflict } from "./contract-cases";
import { runAPIChecks } from "./api-checks";
import { runIntegrationChecks } from "./integration-checks";
import * as app from "@legendapp/spark/app";
import * as windows from "@legendapp/spark/windows";
import * as files from "@legendapp/spark/files";
import { settings } from "@legendapp/spark/settings";
import * as clipboard from "@legendapp/spark/clipboard";
import * as links from "@legendapp/spark/links";
import * as secureStore from "@legendapp/spark/secure-storage";
import { registerShortcut } from "@legendapp/spark/shortcuts";
import { showContextMenu } from "@legendapp/spark/context-menu";
import { createMenu } from "@legendapp/spark/menus";
import { openFileDialog, saveFileDialog } from "@legendapp/spark/dialogs";
import { readText, writeText, writeTextIfUnchanged } from "@legendapp/spark/files";
import type { TestDriver } from "./test-driver";
export type Check = { name: string; passed: boolean; error?: string; duration: number };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (error) { assert((error as { code?: string }).code === code, `Expected ${code}, received ${String(error)}`); return; }
  throw new Error(`Expected ${code} rejection`);
}
async function until(predicate: () => boolean | Promise<boolean>, message: string, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(40); }
  throw new Error(message);
}
export async function runChecks(onResult: (result: Check) => void | Promise<void>, driver?: TestDriver, isolation?: { expect: "absent" | "present"; cleanup: boolean }) {
  const results: Check[] = [];
  async function check(name: string, action: () => Promise<void>) {
    const start = Date.now(); let result: Check;
    try { await action(); result = { name, passed: true, duration: Date.now() - start }; }
    catch (error) { result = { name, passed: false, error: String(error), duration: Date.now() - start }; }
    results.push(result); await onResult(result);
  }
  const token = `sdk-test-${Date.now()}`;
  const root = `${await files.getDirectory("temp")}/${token}`;
  const driverCall = async (method: string, args: object = {}) => JSON.parse(await driver!.call(method, JSON.stringify(args)));
  await files.mkdir(root);
  try {
    await runIntegrationChecks(check);
    await runAPIChecks(check, driver);
    await check("app: identity and runtime metadata", async () => {
      const context = await app.getAppContext();
      assert(context.projectId.length && context.name.length && context.runtime.mode, "Missing host identity");
      assert(context.runtime.modules?.["@legendapp/spark/app"], "Host core missing from runtime inventory");
    });
    await check("files: scoped directories, text, binary, stat, list, copy, move, deletion", async () => {
      const data = await files.getDirectory("data"); const cache = await files.getDirectory("cache");
      assert(data !== cache && data.includes("spark.desktop."), "Directories are not namespaced");
      await files.writeText(`${root}/text.txt`, "Hello 🌍\n");
      assert(await files.readText(`${root}/text.txt`) === "Hello 🌍\n", "UTF-8 roundtrip");
      assert((await files.stat(`${root}/text.txt`)).type === "file", "File stat");
      await files.writeBytes(`${root}/binary`, new Uint8Array([0, 1, 2, 255]));
      assert(String(await files.readBytes(`${root}/binary`)) === "0,1,2,255", "Binary roundtrip");
      await files.copy(`${root}/text.txt`, `${root}/copy`);
      await rejects(() => files.copy(`${root}/text.txt`, `${root}/copy`), "E_EXISTS");
      await files.move(`${root}/copy`, `${root}/moved`);
      assert(!await files.exists(`${root}/copy`) && await files.exists(`${root}/moved`), "Move did not move");
      assert((await files.list(root)).some(entry => entry.name === "moved"), "Directory listing");
      await rejects(() => files.remove(root), "E_NOT_EMPTY");
      await files.remove(`${root}/moved`); assert(!await files.exists(`${root}/moved`), "Removal failed");
      await files.remove(`${root}/moved`);
      await rejects(() => files.readText(`${root}/missing`), "E_NOT_FOUND");
    });
    await check("files: watcher survives two atomic replacements and unsubscribes", async () => {
      const path = `${root}/watched`; await files.writeText(path, "one"); let count = 0;
      const subscription = await files.watch(path, () => { count++; });
      try {
        await files.writeText(path, "two"); await until(() => count > 0, "First write was not observed");
        const previous = count; await files.writeText(path, "three"); await until(() => count > previous, "Atomic replacement lost watcher");
      } finally { await subscription.remove(); }
      await delay(80); const previous = count;
      await files.writeText(path, "four"); await delay(150); assert(count === previous, "Removed watcher fired");
    });
    await check("settings: persistence and serialized concurrent updates", async () => {
      try {
        await settings.remove(token); assert(await settings.get(token) === undefined, "Missing setting");
        await settings.set(token, 0);
        await Promise.all(Array.from({ length: 15 }, () => settings.update<number>(token, count => { if (count !== undefined && typeof count !== "number") throw new Error("Invalid counter"); return (count ?? 0) + 1; })));
        assert(await settings.get(token) === 15, "Concurrent increments lost data");
        await settings.set(token, { text: "hello", enabled: true });
        assert(JSON.stringify(await settings.get(token)) === JSON.stringify({ text: "hello", enabled: true }), "Object roundtrip");
      } finally { await settings.remove(token); }
    });
    if (isolation) await check("Spark Runner isolation: persisted files, settings and Keychain", async () => {
      const key = "sdk-isolation";
      const file = `${await files.getDirectory("data")}/${key}.txt`;
      const context = await app.getAppContext();
      const previous = await settings.get(key);
      const secret = await secureStore.getItemAsync(key);
      const present = await files.exists(file);
      assert((previous !== undefined) === (isolation.expect === "present"), "Settings leaked across projects or did not persist");
      assert((secret !== null) === (isolation.expect === "present"), "Keychain leaked across projects or did not persist");
      assert(present === (isolation.expect === "present"), "File data leaked across projects or did not persist");
      if (present) assert(await files.readText(file) === context.projectId && previous === context.projectId && secret === context.projectId, "Persisted identity mismatch");
      await files.writeText(file, context.projectId); await settings.set(key, context.projectId); await secureStore.setItemAsync(key, context.projectId);
      if (isolation.cleanup) { await files.remove(file); await settings.remove(key); await secureStore.deleteItemAsync(key); }
    });
    await check("dialogs: file IO and optimistic save conflicts", async () => {
      await fileConflict({ readText, writeText, writeTextIfUnchanged }, `${root}/document.txt`);
    });
    await check("windows: root creation, props, frame, visibility, title and close guard", async () => {
      const events: string[] = []; const sub = windows.onWindowEvent(event => { if (event.windowId === token) events.push(event.type); });
      let guard: Awaited<ReturnType<typeof windows.beforeWindowClose>> | undefined;
      try {
        await windows.openWindow({ id: token, title: "SDK automated window", width: 420, height: 320, props: { message: token, readyFile: `${root}/window-ready` } });
        await until(() => files.exists(`${root}/window-ready`), "Secondary React root did not mount");
        assert(await files.readText(`${root}/window-ready`) === token, "Secondary root did not receive props");
        assert((await windows.listWindows()).some(window => window.id === token), "Window not listed");
        await windows.setWindowTitle(token, "Updated title");
        const frame = (await windows.getWindow(token)).frame;
        await windows.setWindowFrame(token, { ...frame, width: 500, height: 380 });
        const info = await windows.getWindow(token); assert(info.title === "Updated title" && info.frame.width === 500, "Window changes failed");
        assert((await windows.getDisplays()).length > 0, "No displays reported");
        await windows.hideWindow(token); assert(!(await windows.getWindow(token)).visible, "Window still visible");
        await windows.showWindow(token); assert((await windows.getWindow(token)).visible, "Window not shown");
        let allowClose = false;
        guard = await windows.beforeWindowClose(token, () => allowClose);
        await windows.closeWindow(token); await until(() => events.includes("beforeClose"), "No close request");
        assert((await windows.getWindow(token)).visible, "Cancelled close destroyed window");
        allowClose = true;
        await windows.closeWindow(token); await until(() => events.includes("closed"), "No close event");
        await until(() => files.exists(`${root}/window-ready.closed`), "Closed React root did not unmount");
        await rejects(() => windows.getWindow(token), "E_NOT_FOUND");
      } finally { await guard?.remove(); sub.remove(); if ((await windows.listWindows()).some(window => window.id === token)) await windows.closeWindow(token); await windows.showWindow("main"); }
    });
    await check("clipboard: native reads", async () => {
      assert(typeof await clipboard.getStringAsync() === "string", "Clipboard text result");
      assert(typeof await clipboard.hasStringAsync() === "boolean", "Clipboard presence result");
    });
    await check("secure storage: missing, write, update, empty value and delete", async () => {
      try {
        await secureStore.deleteItemAsync(token); assert(await secureStore.getItemAsync(token) === null, "Missing key should be null");
        await secureStore.setItemAsync(token, "secret 🌍"); assert(await secureStore.getItemAsync(token) === "secret 🌍", "Keychain roundtrip");
        await secureStore.setItemAsync(token, ""); assert(await secureStore.getItemAsync(token) === "", "Empty key differs from missing key");
        await secureStore.deleteItemAsync(token); assert(await secureStore.getItemAsync(token) === null, "Delete failed");
      } finally { await secureStore.deleteItemAsync(token); }
    });
    await check("links: URL resolution and recent-document listing", async () => {
      assert(await links.canOpenURL("https://example.com"), "No HTTPS handler");
      assert(!await links.canOpenURL("spark-sdk-unknown-scheme://test"), "Unexpected scheme handler");
      await documents.clearRecentDocuments();
      try {
        const path = `${root}/text.txt`;
        await documents.noteRecentDocument(path); await documents.noteRecentDocument(path);
        assert((await documents.getRecentDocuments()).filter(item => item.path === path).length === 1, "Recent documents must deduplicate");
      } finally { await documents.clearRecentDocuments(); }
    });
    await check("shortcuts: register, conflict, removal and re-register", async () => {
      const first = await registerShortcut("Command+Shift+9", () => {});
      try { await rejects(() => registerShortcut("Command+Shift+9", () => {}), "E_BUSY"); }
      finally { await first.remove(); }
      await (await registerShortcut("Command+Shift+9", () => {})).remove();
    });
    await check("context menu: empty menu resolves cancellation", async () => {
      assert((await showContextMenu({ windowId: "main", items: [], position: { x: 10, y: 10 } })).canceled, "Empty menu should cancel");
    });
    if (driver) {
      await check("clipboard: write and restore every original pasteboard format", async () => {
        await driverCall("saveClipboard");
        try { await clipboard.setStringAsync(token); assert(await clipboard.getStringAsync() === token && await clipboard.hasStringAsync(), "Clipboard write failed"); }
        finally { await driverCall("restoreClipboard"); }
      });
      await check("clipboard: HTML, RTF, PNG and file URL roundtrips", async () => {
        await driverCall("saveClipboard");
        try {
          const imagePNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
          await clipboard.writeClipboard({ text: token, html: `<b>${token}</b>`, rtf: "{\\rtf1\\ansi SDK test}", image: { format: "png", bytes: toByteArray(imagePNG) } });
          const rich = await clipboard.readClipboard();
          assert(rich.text === token && rich.html === `<b>${token}</b>` && rich.rtf?.includes("SDK test") && !!rich.image?.bytes.length, "Rich clipboard lost a representation");
          try { await clipboard.writeClipboard({ image: { format: "png", bytes: new Uint8Array([1]) } }); } catch {}
          assert(await clipboard.getStringAsync() === token, "Invalid image erased clipboard");
          await clipboard.writeClipboard({ files: [`${root}/text.txt`] });
          assert((await clipboard.readClipboard()).files?.[0] === `${root}/text.txt`, "File URL clipboard failed");
        } finally { await driverCall("restoreClipboard"); }
      });
      await check("shortcuts: actual AppKit key interception", async () => {
        let count = 0; const sub = await registerShortcut("Command+Shift+K", () => { count++; }, { windowId: "main" });
        try { await driverCall("key", { key: "k", modifiers: (1 << 20) | (1 << 17) }); await until(() => count === 1, "Shortcut did not dispatch"); }
        finally { await sub.remove(); }
        await driverCall("key", { key: "k", modifiers: (1 << 20) | (1 << 17) }); await delay(100); assert(count === 1, "Removed shortcut fired");
      });
      await check("menus: native selection, checked and disabled state", async () => {
        let selected = "";
        const menu = await createMenu({ id: token, items: [{ type: "submenu", id: "sdk-test", label: "SDK Test", items: [{ type: "action", id: "item", label: token }, { type: "action", id: "disabled", label: "SDK Disabled", disabled: true }, { type: "checkbox", id: "checked", label: "SDK Checked", checked: true }] }], onAction: event => { selected = event.itemId; } });
        try {
          await driverCall("menu", { title: token }); await until(() => selected === "item", "Menu action not delivered");
          assert(await driverCall("menuState", { title: "SDK Disabled" }) === "disabled", "Disabled item enabled");
          assert(await driverCall("menuState", { title: "SDK Checked" }) === "checked", "Checked state missing");
        } finally { await menu.remove(); }
      });
      await check("dialogs: native open/save cancellation", async () => {
        const opened = openFileDialog({ title: "SDK automated open" });
        await driverCall("cancelPanel"); assert((await opened).canceled, "Open cancellation result");
        const saved = saveFileDialog({ defaultName: "SDK-test.txt" });
        await driverCall("cancelPanel"); assert((await saved).canceled, "Save cancellation result");
      });
      await check("dialogs: native save acceptance serializes a selected path", async () => {
        const saved = saveFileDialog({ defaultName: "accepted.txt", directory: root });
        // The XCTest driver presses Save in the system-owned remote panel.
        const result = await saved;
        assert(!result.canceled && result.path === `${root}/accepted.txt`, "Save panel returned an invalid path");
      });
      await check("app: second instance forwards arguments and exits", async () => {
        let received = false; const sub = app.onAppEvent(event => { if (event.type === "secondInstance") received = true; });
        try { assert(await driverCall("secondInstance") === 0, "Second instance did not exit cleanly"); await until(() => received, "No second-instance event"); }
        finally { sub.remove(); }
      });
      await check("context menu: real popup cancellation", async () => {
        const selected = showContextMenu({ windowId: "main", items: [{ type: "action", id: "one", label: "SDK popup" }], position: { x: 100, y: 100 } });
        await driverCall("escape"); assert((await selected).canceled, "Popup cancellation result");
      });
      await check("links: cold and warm delivery through AppDelegate", async () => {
        const seen: documents.OpenRequest[] = [];
        await driverCall("openURLs", { urls: [`spark-test://${token}/cold`] });
        const sub = await documents.subscribeToOpenRequests(event => { seen.push(event); });
        try {
          await until(() => seen.some(event => event.type === "url" && event.url.endsWith("/cold")), "Queued launch was lost");
          await driverCall("openURLs", { urls: [`spark-test://${token}/warm`, `file://${root}/text.txt`] });
          await until(() => seen.some(event => event.type === "file") && seen.some(event => event.type === "url" && event.url.endsWith("/warm")), "Warm events missing");
          assert(seen.filter(event => event.type === "url" && event.url.endsWith("/cold")).length === 1, "Queued launch duplicated");
        } finally { sub.remove(); }
      });
      await check("app: quit interception cancels termination", async () => {
        let requested = false;
        const sub = await app.beforeQuit(() => { requested = true; return false; });
        try { await app.quit(); await until(() => requested, "Quit handler did not run"); await delay(100); assert((await app.getAppContext()).projectId, "App no longer responds"); }
        finally { await sub.remove(); }
      });
    }
  } finally { await files.remove(root, { recursive: true }); }
  return { results, passed: results.every(result => result.passed), context: await app.getAppContext(), dataDirectory: await files.getDirectory("data") };
}
