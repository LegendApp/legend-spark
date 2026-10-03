import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, expect, vi, test } from "vitest";
const calls: { native: string; method: string; args: any }[] = [];
const handlers = new Map<string, (args: any) => unknown | Promise<unknown>>();
const subscriptions = new Map<string, Set<(event: any) => void>>();
const moduleObjects = new Map<string, any>();
function module(name: string) {
  if (!moduleObjects.has(name)) moduleObjects.set(name, new Proxy({ name }, { get(target, key) {
    if (key === "name") return target.name;
    return async (...args: any[]) => {
      const method = (key === "call" || key === "binaryCall") ? args[0] : String(key);
      const value = (key === "call" || key === "binaryCall") ? JSON.parse(args[1]) : args;
      if (key === "binaryCall" && args[2] !== undefined) value.bytes = new Uint8Array(args[2], args[3], args[4]).slice();
      calls.push({ native: name, method, args: value });
      const result = await handlers.get(`${name}.${method}`)?.(value);
      return key === "call" ? JSON.stringify(result ?? null) : key === "binaryCall" ? result ?? null : result;
    };
  } }));
  return moduleObjects.get(name);
}
function emit(name: string, event: string, value: unknown) {
  for (const listener of subscriptions.get(`${name}.${event}`) ?? []) listener(value);
}
const platform = { OS: "macos" };
vi.doMock("react-native", () => ({
  Platform: platform,
  TurboModuleRegistry: { getEnforcing: module, get: module },
  NativeEventEmitter: class {
    constructor(private native: { name: string }) {}
    addListener(event: string, listener: (event: any) => void) {
      const key = `${this.native.name}.${event}`;
      if (!subscriptions.has(key)) subscriptions.set(key, new Set());
      subscriptions.get(key)!.add(listener);
      return { remove: () => subscriptions.get(key)!.delete(listener) };
    }
  },
}));
const notifications = await import("../packages/notifications/src/index.ts");
const tray = await import("../packages/tray/src/index.ts");
const updates = await import("../packages/updates/src/index.ts");
const app = await import("../packages/desktop-app/src/index.ts");
const files = await import("../packages/file-system/src/index.ts");
const clipboard = await import("../packages/clipboard/src/index.ts");
const links = await import("../packages/desktop-links/src/index.ts");
const documents = await import("../packages/documents/src/requests.ts");
const secureStore = await import("../packages/secure-storage/src/index.ts");
const shortcuts = await import("../packages/desktop-shortcuts/src/index.ts");
const menus = await import("../packages/native-menu/src/index.ts");
const context = await import("../packages/context-menu/src/index.ts");
const dialogs = await import("../packages/file-dialog/src/index.ts");
beforeEach(() => {
  platform.OS = "macos"; calls.length = 0; handlers.clear(); subscriptions.clear();
  // Clearing native subscriptions models a new event host, including its identity.
  moduleObjects.delete("NativeDesktopApp");
});
const tick = () => sleep(1);
function nativeError(code: string) { return Object.assign(new Error(code), { code }); }

test("app context, activation, hide and quit call the native host", async () => {
  handlers.set("NativeDesktopApp.context", () => ({ projectId: "a", name: "App", version: "1", launchArguments: [], runtime: { mode: "dev", modules: {} } }));
  handlers.set("NativeDesktopApp.quit", () => ({ quitRequested: true }));
  expect((await app.getAppContext()).projectId).toBe("a");
  await app.activate(); await app.hide(); await app.quit();
  expect(calls.map(call => call.method)).toEqual(["context", "activate", "hide", "quit"]);
});
test("quit guards have independent IDs and dispose once", async () => {
  const guard = await app.beforeQuit(async () => true);
  const id = calls.at(-1)!.args.id;
  const second = await app.beforeQuit(() => false);
  expect(calls.at(-1)!.args.id).not.toBe(id);
  emit("NativeDesktopApp", "desktop", { type: "beforeQuit", guardId: id, requestId: 1 }); await tick();
  expect(calls.find(call => call.method === "replyQuit")?.args.allow).toBe(true);
  await guard.remove(); await guard.remove();
  expect(calls.filter(call => call.method === "quitGuard" && !call.args.enabled)).toHaveLength(1);
  await second.remove();
});
test("throwing or disposed quit guards cancel instead of discarding edits", async () => {
  let guard = await app.beforeQuit(() => { throw new Error("save failed"); }, { onError: () => {} });
  emit("NativeDesktopApp", "desktop", { type: "beforeQuit", guardId: calls.filter(call => call.method === "quitGuard").at(-1)!.args.id, requestId: 1 }); await tick();
  expect(calls.find(call => call.method === "replyQuit")?.args.allow).toBe(false); await guard.remove();
  let finish!: (allow: boolean) => void;
  guard = await app.beforeQuit(() => new Promise<boolean>(resolve => { finish = resolve; }));
  emit("NativeDesktopApp", "desktop", { type: "beforeQuit", guardId: calls.filter(call => call.method === "quitGuard").at(-1)!.args.id, requestId: 1 }); await tick(); await guard.remove(); finish(true); await tick();
  expect(calls.filter(call => call.method === "replyQuit").at(-1)?.args.allow).toBe(false);
});
test("failed guard registration cleans listeners and permits retry", async () => {
  handlers.set("NativeDesktopApp.quitGuard", () => { throw new Error("bridge"); });
  await expect(app.beforeQuit(() => true)).rejects.toMatchObject({ code: "E_NATIVE" });
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
  handlers.delete("NativeDesktopApp.quitGuard"); await (await app.beforeQuit(() => true)).remove();
});
test("filesystem errors preserve permission failures instead of pretending files are absent", async () => {
  handlers.set("NativeDesktopFileSystem.stat", () => { throw nativeError("E_NOT_FOUND"); }); expect(await files.exists("/missing")).toBe(false);
  handlers.set("NativeDesktopFileSystem.stat", () => { throw nativeError("E_PERMISSION"); }); await expect(files.exists("/protected")).rejects.toThrow("E_PERMISSION");
  await expect(files.readText("relative")).rejects.toThrow("absolute"); await expect(files.writeText("/a\0b", "text")).rejects.toThrow();
});
test("filesystem binary and mutation APIs preserve paths and opt-in recursive deletion", async () => {
  handlers.set("NativeDesktopFileSystem.directory", () => "/data");
  handlers.set("NativeDesktopFileSystem.readText", () => "text");
  handlers.set("NativeDesktopFileSystem.readBytes", () => new Uint8Array([0]).buffer);
  handlers.set("NativeDesktopFileSystem.list", () => ["a"]);
  handlers.set("NativeDesktopFileSystem.remove", () => true);
  handlers.set("NativeDesktopFileSystem.copy", () => null);
  handlers.set("NativeDesktopFileSystem.move", () => null);
  await files.getDirectory("data"); await files.readText("file:///tmp/a%20b"); await files.writeText("/a", "text"); await files.readBytes("/a"); await files.writeBytes("/b", new Uint8Array([0]));
  await files.mkdir("/dir"); await files.list("/dir"); await files.copy("/a", "/b"); await files.move("/b", "/c"); await files.remove("/dir"); await files.remove("/dir", { recursive: true });
  expect(calls[1]?.args.path).toBe("/tmp/a b"); expect(calls.filter(call => call.method === "remove").map(call => call.args.recursive)).toEqual([false, true]);
  await files.copy("/a", "/b", { overwrite: true }); await files.move("/b", "/c", { overwrite: true });
  expect(calls.filter(call => ["copy", "move"].includes(call.method)).map(call => call.args.overwrite)).toEqual([false, false, true, true]);
  await expect(files.copy("/a", "/b", { overwrote: true } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});
test("misspelled file options reject before any native dispatch", async () => {
  const previous = calls.length;
  await expect(files.openFile("/a", { modee: "write" } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(files.writeChunks("/a", [], { modee: "write" } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(() => files.readChunks("/a", { chunksize: 1024 } as any)).toThrow(/readChunks/);
  await expect(files.mkdir("/a", { recursize: true } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(files.remove("/a", { force: true } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(files.watch("/a", () => {}, { recursize: true } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(previous);
});
test("chunk iterators validate at their documented construction and consumption boundaries", async () => {
  const previous = calls.length;
  const iterator = files.readChunks("relative");
  expect(iterator).toBeDefined();
  await expect(iterator.next()).rejects.toThrow("absolute");
  await expect(files.writeChunks("relative", [])).rejects.toThrow("absolute");
  expect(calls).toHaveLength(previous);
});
test("watches filter by registration id and remove idempotently", async () => {
  const observed: string[] = []; const first = await files.watch("/first", path => observed.push(path)); const second = await files.watch("/second", path => observed.push(path));
  const firstID = calls[0]?.args.id; const secondID = calls[1]?.args.id;
  emit("NativeDesktopFileSystem", "change", { id: secondID, path: "/second" }); expect(observed).toEqual(["/second"]);
  await first.remove(); await first.remove(); emit("NativeDesktopFileSystem", "change", { id: firstID, path: "/first" }); expect(observed).toHaveLength(1);
  await second.remove(); expect(calls.filter(call => call.method === "unwatch")).toHaveLength(2);
});
test("failed watchers remove their listener", async () => {
  handlers.set("NativeDesktopFileSystem.watch", () => { throw nativeError("E_NOT_FOUND"); });
  await expect(files.watch("/missing/a", () => {})).rejects.toThrow(); expect(subscriptions.get("NativeDesktopFileSystem.change")?.size).toBe(0);
});
test("clipboard and Keychain preserve empty strings and missing values", async () => {
  handlers.set("NativeDesktopClipboard.getString", () => ""); handlers.set("NativeDesktopClipboard.hasString", () => false);
  handlers.set("NativeDesktopClipboard.setString", () => true);
  expect(await clipboard.getStringAsync()).toBe(""); expect(await clipboard.hasStringAsync()).toBe(false); expect(await clipboard.setStringAsync("hello")).toBe(true);
  expect(await secureStore.getItemAsync("key")).toBeNull(); await secureStore.setItemAsync("key", ""); expect(calls.at(-1)?.args.value).toBe(""); await secureStore.deleteItemAsync("key");
  await expect(secureStore.getItemAsync("")).rejects.toThrow(); await expect(secureStore.getItemAsync("x".repeat(201))).rejects.toThrow();
});
test("links deduplicate queued/live overlap and stop delivery on removal", async () => {
  const cold = { type: "openURL" as const, id: "cold", url: "demo://cold" };
  handlers.set("NativeDesktopApp.pendingURLs", () => { emit("NativeDesktopApp", "desktop", cold); return [cold]; });
  const received: import("../packages/documents/src/requests").OpenRequest[] = []; const sub = await documents.subscribeToOpenRequests(event => received.push(event)); expect(received).toEqual([{ ...cold, type: "url" }]);
  emit("NativeDesktopApp", "desktop", { type: "focus" }); expect(received).toHaveLength(1);
  sub.remove(); emit("NativeDesktopApp", "desktop", { ...cold, id: "warm" }); expect(received).toHaveLength(1);
});
test("links registration failures clean up listeners and URL validation is early", async () => {
  handlers.set("NativeDesktopApp.pendingURLs", () => { throw new Error("bridge"); });
  await expect(documents.subscribeToOpenRequests(() => {})).rejects.toThrow("bridge"); expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
  await expect(links.openURL("example.com")).rejects.toThrow("scheme"); expect(await links.openURL("https://example.com")).toBe(true); handlers.set("NativeDesktopLinks.canOpen", () => true); handlers.set("NativeDesktopLinks.recent", () => []); await links.canOpenURL("demo://test"); await documents.noteRecentDocument("file:///tmp/a"); await documents.getRecentDocuments(); await documents.clearRecentDocuments();
});
test("shortcuts dispatch only their registration and clean up on failure/removal", async () => {
  let count = 0; const sub = await shortcuts.registerShortcut("Cmd+K", () => { count++; }); const id = calls[0]?.args.id;
  emit("NativeDesktopShortcuts", "shortcut", { id: "other" }); emit("NativeDesktopShortcuts", "shortcut", { id }); expect(count).toBe(1);
  await sub.remove(); await sub.remove(); emit("NativeDesktopShortcuts", "shortcut", { id }); expect(count).toBe(1);
  handlers.set("NativeDesktopShortcuts.register", () => { throw nativeError("E_BUSY"); });
  await expect(shortcuts.registerShortcut("Cmd+K", () => {})).rejects.toThrow(); expect(subscriptions.get("NativeDesktopShortcuts.shortcut")?.size).toBe(0);
});
test("context menus validate location, duplicate ids and cancellation", async () => {
  await expect(context.showContextMenu({ windowId: "main", items: [], position: { x: NaN, y: 0 } })).rejects.toThrow("finite");
  await expect(context.showContextMenu({ windowId: "main", items: [{ type: "action", id: "x", label: "A" }, { type: "action", id: "x", label: "B" }], position: { x: 0, y: 0 } })).rejects.toThrow("unique");
  handlers.set("NativeContextMenu.showMenu", () => ""); expect(await context.showContextMenu({ windowId: "main", items: [], position: { x: 0, y: 0 } })).toEqual({ canceled: true });
  handlers.set("NativeContextMenu.showMenu", () => "selected"); expect(await context.showContextMenu({ windowId: "main", items: [{ type: "action", id: "selected", label: "Select" }], position: { x: 0, y: 0 } })).toEqual({ canceled: false, itemId: "selected" });
});
test("dialogs parse selected paths and native cancellation, preserving save conflicts", async () => {
  handlers.set("NativeFileDialog.open", () => '["/tmp/example.txt"]'); expect(await dialogs.openFileDialog()).toEqual({ canceled: false, paths: ["/tmp/example.txt"] });
  handlers.set("NativeFileDialog.open", () => "null"); expect(await dialogs.openFileDialog()).toEqual({ canceled: true });
  handlers.set("NativeFileDialog.save", () => '"/tmp/save.txt"'); expect(await dialogs.saveFileDialog()).toEqual({ canceled: false, path: "/tmp/save.txt" });
  handlers.set("NativeDesktopFileSystem.writeTextIfUnchanged", () => false); expect(await files.writeTextIfUnchanged("/a", "old", "new")).toEqual({ written: false });
  handlers.set("NativeDesktopFileSystem.readText", () => "text"); expect(await files.readText("/a")).toBe("text"); await files.writeText("/a", "new");
  await files.revealInFileManager("/a");
});
test("application menus publish owned snapshots and filter action identity", async () => {
  const configuration: import("../packages/native-menu/src/api").MenuRootItem[] = [{ type: "submenu", id: "file", label: "File", items: [{ type: "checkbox", id: "save", label: "Save", checked: true }] }];
  const received: unknown[] = [];
  const menu = await menus.createMenu({ id: "owner", items: configuration, onAction: event => received.push(event) });
  const native = JSON.parse(calls.at(-1)!.args[0]);
  expect(native[0].items[0]).toMatchObject({ id: "save", title: "Save", checked: true });
  emit("NativeMenu", "NativeMenuAction", { ownerId: native[0]._sparkOwner, itemId: "save", private: true });
  emit("NativeMenu", "NativeMenuAction", { ownerId: "other", itemId: "save" });
  expect(received).toEqual([{ type: "action", itemId: "save" }]);
  await menu.update({ items: [] }); await menu.remove(); await menu.remove();
  expect(calls.map(call => call.method)).toEqual(["publish", "publish", "publish"]);
});

test("notifications validate before transport and distinguish permission reads from prompts", async () => {
  for (const notification of [{ id: "../bad", content: { title: "test" } }, { id: "test", content: { title: " " } }, { id: "test", content: { title: "test" }, delay: 0 }]) await expect(notifications.showNotification(notification)).rejects.toThrow();
  expect(calls).toHaveLength(0);
  handlers.set("NativeDesktopNotifications.permission", () => "authorized");
  handlers.set("NativeDesktopNotifications.requestPermission", () => "authorized");
  expect(await notifications.getNotificationPermission()).toMatchObject({ status: "granted", granted: true }); await notifications.requestNotificationPermission();
  await notifications.scheduleNotification({ id: "test", content: { title: "Hello", data: { route: "inbox" } }, trigger: { type: "delay", delaySeconds: 2 } });
  expect(calls.at(-1)?.args).toEqual({ id: "test", title: "Hello", data: { route: "inbox" }, sound: "none", delay: 2 });
  await notifications.cancelNotification("test"); await notifications.dismissNotification("test");
  await notifications.cancelAllNotifications(); await notifications.dismissAllNotifications();
  expect(calls.map(call => call.method)).toEqual(["permission", "requestPermission", "show", "cancel", "dismiss", "cancelAll", "dismissAll"]);
});
test("notification responses deduplicate queued/live overlap and dispose", async () => {
  const event = { type: "notificationResponse", id: "r1", notificationId: "n1", action: "open", data: {} };
  handlers.set("NativeDesktopNotifications.responses", () => { emit("NativeDesktopApp", "desktop", event); return [event]; });
  const results: unknown[] = []; const sub = await notifications.onNotificationResponse(event => results.push(event));
  expect(results).toHaveLength(1); sub.remove(); emit("NativeDesktopApp", "desktop", { ...event, id: "r2" }); expect(results).toHaveLength(1);
});
test("failed notification subscriptions remove their native listener", async () => {
  handlers.set("NativeDesktopNotifications.responses", () => { throw new Error("unavailable"); });
  await expect(notifications.onNotificationResponse(() => {})).rejects.toThrow("unavailable");
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});
test("tray validates duplicate menu ids and cleans failed registrations", async () => {
  await expect(tray.createTray({ id: "x", title: "X", menu: [{ type: "action", id: "a", label: "A" }, { type: "action", id: "a", label: "B" }] })).rejects.toThrow("unique");
  handlers.set("NativeDesktopTray.create", () => { throw nativeError("E_ALREADY_EXISTS"); });
  await expect(tray.createTray({ id: "x", title: "X" })).rejects.toThrow("E_ALREADY_EXISTS");
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});
test("tray scopes actions, serializes updates and waits before removing", async () => {
  const actions: unknown[] = []; const item = await tray.createTray({ id: "test", macos: { symbol: "star" }, menu: [{ type: "action", id: "open", label: "Open" }], onAction: event => actions.push(event) });
  emit("NativeDesktopApp", "desktop", { type: "trayClick", trayId: "other" });
  emit("NativeDesktopApp", "desktop", { type: "trayAction", trayId: "test", instanceId: calls[0].args.instanceId, itemId: "open" }); expect(actions).toHaveLength(1);
  await Promise.all([item.update({ title: "One" }), item.update({ title: "Two" }), item.remove()]);
  await item.remove(); expect(calls.map(call => call.method)).toEqual(["create", "update", "update", "remove"]);
  await expect(item.update({ title: "Late" })).rejects.toThrow("removed");
});
test("updates expose availability without starting and preserve native errors", async () => {
  handlers.set("NativeDesktopUpdates.status", () => ({ available: false, reason: "go", started: false, canCheck: false, automaticallyChecks: false, checkIntervalSeconds: null }));
  expect(await updates.getUpdateStatus()).toMatchObject({ available: false, reason: "go", started: false, canCheck: false, automaticallyChecks: false, checkIntervalSeconds: null });
  expect(calls.map(call => call.method)).toEqual(["status"]);
  handlers.set("NativeDesktopUpdates.check", () => { throw nativeError("E_UNAVAILABLE"); });
  await expect(updates.checkForUpdates()).rejects.toThrow("E_UNAVAILABLE");
  await updates.startUpdates(); await updates.configureUpdates({ automaticallyChecks: true });
  const events: unknown[] = []; const sub = updates.onUpdateEvent(event => events.push(event));
  emit("NativeDesktopApp", "desktop", { type: "update", state: "available", version: "2" });
  emit("NativeDesktopApp", "desktop", { type: "trayClick" }); expect(events).toHaveLength(1); sub.remove();
});

const processes = await import("../packages/processes/src/index.ts");
const globalShortcuts = await import("../packages/global-shortcuts/src/index.ts");
const system = await import("../packages/system/src/index.ts");
const messages = await import("../packages/message-dialog/src/index.ts");
test("global hotkey conflicts clean subscriptions and distinct registrations dispose independently", async () => {
  let hits = 0;
  const first = await globalShortcuts.registerGlobalShortcut("Cmd+Shift+J", () => hits++);
  const firstID = calls.at(-1)!.args.id;
  const second = await globalShortcuts.registerGlobalShortcut("Cmd+Shift+K", () => hits += 10);
  emit("NativeDesktopApp", "desktop", { type: "globalShortcut", id: firstID }); expect(hits).toBe(1);
  await first.remove(); await first.remove();
  emit("NativeDesktopApp", "desktop", { type: "globalShortcut", id: firstID }); expect(hits).toBe(1);
  handlers.set("NativeDesktopGlobalShortcuts.register", () => { throw nativeError("E_BUSY"); });
  await expect(globalShortcuts.registerGlobalShortcut("Cmd+Shift+K", () => {})).rejects.toThrow("E_BUSY");
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(1); await second.remove();
});
test("process subscriptions exist before launch and survive immediate exit", async () => {
  handlers.set("NativeDesktopProcesses.spawn", args => {
    emit("NativeDesktopApp", "desktop", { type: "processOutput", processId: args.id, stream: "stdout", bytes: new TextEncoder().encode("hi").buffer });
    emit("NativeDesktopApp", "desktop", { type: "processExit", processId: args.id, result: { exitCode: 0, terminated: false, terminationSignal: null, timedOut: false, outputTruncated: false, stdout: new TextEncoder().encode("hi").buffer, stderr: new ArrayBuffer(0) } });
  });
  const chunks: string[] = [];
  const child = await processes.spawn({ target: { type: "executable", path: "/bin/echo" }, args: ["hi"], onOutput: chunk => chunks.push(new TextDecoder().decode(chunk.bytes)) });
  expect(await child.exited).toMatchObject({ stdout: new TextEncoder().encode("hi"), exit: { type: "exited", code: 0 } }); expect(chunks).toEqual(["hi"]);
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0); await child.terminate();
  await expect(child.write("late")).rejects.toThrow("closed");
});
test("process validation and failed launches do not leak listeners", async () => {
  for (const options of [{ target: { type: "executable", path: "echo" } }, { target: { type: "helper", name: "../escape" } }, { target: { type: "helper", name: "" } }, { target: { type: "executable", path: "/bin/echo" }, input: 123 as never }, { target: { type: "executable", path: "/bin/echo" }, timeoutMs: -1 }, { target: { type: "executable", path: "/bin/echo" }, env: { "BAD=KEY": "x" } }]) await expect(processes.spawn(options as never)).rejects.toThrow();
  handlers.set("NativeDesktopProcesses.spawn", () => { throw nativeError("E_NOT_FOUND"); });
  await expect(processes.spawn({ target: { type: "executable", path: "/missing" } })).rejects.toThrow("E_NOT_FOUND"); expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});
test("dialog cancellation, default buttons and input validation", async () => {
  const previous = calls.length;
  await expect(dialogs.openFileDialog({ title: undefined, typo: undefined } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(dialogs.saveFileDialog({ defaultName: undefined, typo: undefined } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(messages.showMessage({ title: "Bad", typo: undefined } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(previous);
  handlers.set("NativeDesktopMessageDialog.show", () => ({ button: 0, checked: false }));
  expect(await messages.confirm("Continue?", { windowId: "main" })).toBe(false);
  expect(calls.at(-1)?.args).toMatchObject({ windowId: "main", defaultButton: 1, cancelButton: 0 });
  await expect(messages.showMessage({ title: "Bad", buttons: [] })).rejects.toThrow();
  await expect(messages.showMessage({ title: "Bad", defaultButtonId: "missing" })).rejects.toThrow();
});
test("rich clipboard validates file paths before replacing clipboard contents", async () => {
  await clipboard.writeClipboard({ text: "Hello", html: "<b>Hello</b>" });
  expect(calls.at(-1)?.args).toEqual({ text: "Hello", html: "<b>Hello</b>" });
  await expect(clipboard.writeClipboard({ files: ["relative"] })).rejects.toThrow();
  await expect(clipboard.writeClipboard({ files: ["/tmp/a"], text: "mixed" } as never)).rejects.toThrow();
  handlers.set("NativeDesktopClipboard.read", () => ({ text: "Hello", files: ["/tmp/a"] })); expect(await clipboard.readClipboard()).toMatchObject({ files: ["/tmp/a"] });
});
test("sleep assertions release once and system events filter unrelated traffic", async () => {
  handlers.set("NativeDesktopSystem.preventSleep", () => 123);
  const assertion = await system.preventSleep({ reason: "Exporting" }); await assertion.remove(); await assertion.remove();
  expect(calls.filter(call => call.method === "allowSleep")).toHaveLength(1);
  const events: string[] = []; const subscription = await system.onSystemEvent(event => events.push(event.type));
  emit("NativeDesktopApp", "desktop", { type: "wake" }); emit("NativeDesktopApp", "desktop", { type: "activate" }); expect(events).toEqual(["wake"]); await subscription.remove();
});
test("Dock menus identify their owner and remove only once", async () => {
  const selected: string[] = [];
  const menu = await system.createDockMenu({ items: [{ type: "action", id: "open", label: "Open" }], onAction: event => selected.push(event.itemId) });
  const owner = calls.at(-1)?.args.owner;
  emit("NativeDesktopApp", "desktop", { type: "dockAction", owner: "other", id: "open" });
  emit("NativeDesktopApp", "desktop", { type: "dockAction", owner, id: "open" }); expect(selected).toEqual(["open"]);
  await menu.remove(); await menu.remove(); expect(calls.filter(call => call.method === "clearDockMenu")).toHaveLength(1);
});

test("Expo clipboard subset handles formats, boolean results, and native failures", async () => {
  handlers.set("NativeDesktopClipboard.getString", args => args.format === "html" ? "<b>Hello</b>" : "Hello");
  handlers.set("NativeDesktopClipboard.hasString", () => true);
  handlers.set("NativeDesktopClipboard.setString", () => true);
  expect(await clipboard.getStringAsync()).toBe("Hello");
  expect(await clipboard.getStringAsync({ preferredFormat: clipboard.StringFormat.HTML })).toBe("<b>Hello</b>");
  expect(await clipboard.setStringAsync("<b>Hello</b>", { inputFormat: clipboard.StringFormat.HTML })).toBe(true);
  expect(calls.at(-1)?.args).toEqual({ text: "<b>Hello</b>", format: "html" });
  expect(await clipboard.hasStringAsync()).toBe(true);
  handlers.set("NativeDesktopClipboard.setString", () => false);
  expect(await clipboard.setStringAsync("denied")).toBe(false);
  await expect(clipboard.setStringAsync(123 as any)).rejects.toThrow("string");
  await expect(clipboard.getStringAsync({ preferredFormat: "bad" as any })).rejects.toThrow("format");
  handlers.set("NativeDesktopClipboard.setString", () => { throw nativeError("E_CLIPBOARD"); });
  await expect(clipboard.setStringAsync("fail")).rejects.toThrow("E_CLIPBOARD");
});

test("Expo SecureStore subset preserves empty values and rejects unsupported options", async () => {
  const store = await import("../packages/secure-storage/src/index.ts");
  expect(await store.isAvailableAsync()).toBe(true);
  expect(await store.getItemAsync("missing")).toBeNull();
  handlers.set("NativeDesktopSecureStorage.get", () => "");
  expect(await store.getItemAsync("empty")).toBe("");
  expect(await store.setItemAsync("key", "value")).toBeUndefined();
  expect(calls.at(-1)?.args).toEqual({ key: "key", value: "value" });
  expect(await store.deleteItemAsync("key")).toBeUndefined();
  await expect(store.getItemAsync("key with spaces")).rejects.toThrow("keys");
  await expect(store.setItemAsync("key", 123 as any)).rejects.toThrow("strings");
  const previous = calls.length;
  await expect(store.getItemAsync("key", { requireAuthentication: true } as any)).rejects.toThrow("options");
  expect(calls).toHaveLength(previous);
  handlers.set("NativeDesktopSecureStorage.get", () => { throw nativeError("E_KEYCHAIN"); });
  await expect(store.getItemAsync("key")).rejects.toThrow("E_KEYCHAIN");
});

test("Expo linking separates stable initial URLs, live URLs, and file events", async () => {
  handlers.set("NativeDesktopApp.initialURL", () => "demo://initial");
  const received: string[] = [];
  const subscription = links.addEventListener("url", event => received.push(event.url));
  expect(await links.getInitialURL()).toBe("demo://initial");
  emit("NativeDesktopApp", "desktop", { type: "openURL", url: "demo://initial", initial: true });
  emit("NativeDesktopApp", "desktop", { type: "openFile", url: "file:///tmp/a" });
  emit("NativeDesktopApp", "desktop", { type: "openURL", url: "demo://warm", initial: false });
  expect(received).toEqual(["demo://warm"]);
  expect(await links.getInitialURL()).toBe("demo://initial");
  subscription.remove(); subscription.remove();
  emit("NativeDesktopApp", "desktop", { type: "openURL", url: "demo://removed" });
  expect(received).toHaveLength(1);
  expect(() => links.addEventListener("bad" as any, () => {})).toThrow();
});

test("web SecureStore stays unavailable without native dispatch", async () => {
  const web = await import("../packages/secure-storage/src/index.web.ts");
  expect(await web.isAvailableAsync()).toBe(false);
  await expect(web.setItemAsync("secret", "value")).rejects.toThrow("unavailable");
  expect(calls).toHaveLength(0);
});

test("mobile adapters delegate the shared subset to Expo without native dispatch", async () => {
  const forwarded: string[] = [];
  vi.doMock("expo-clipboard", () => ({
    getStringAsync: async () => "expo text",
    setStringAsync: async () => { forwarded.push("clipboard"); return false; },
    hasStringAsync: async () => true,
    StringFormat: { PLAIN_TEXT: "plainText", HTML: "html" },
  }));
  vi.doMock("expo-secure-store", () => ({
    isAvailableAsync: async () => true,
    getItemAsync: async () => "expo secret",
    setItemAsync: async () => { forwarded.push("secret"); },
    deleteItemAsync: async () => { forwarded.push("delete"); },
  }));
  vi.doMock("expo-linking", () => ({
    getInitialURL: async () => "expo://initial",
    openURL: async () => { forwarded.push("url"); },
    canOpenURL: async () => true,
    addEventListener: () => ({ remove() {} }),
  }));
  const mobileClipboard = await import("../packages/clipboard/src/index.ios.ts");
  const mobileSecure = await import("../packages/secure-storage/src/index.android.ts");
  const mobileLinks = await import("../packages/desktop-links/src/index.web.ts");
  expect(await mobileClipboard.getStringAsync()).toBe("expo text");
  expect(await mobileClipboard.setStringAsync("text")).toBe(false);
  expect(await mobileSecure.getItemAsync("key")).toBe("expo secret");
  await mobileSecure.setItemAsync("key", "value"); await mobileSecure.deleteItemAsync("key");
  expect(await mobileLinks.getInitialURL()).toBe("expo://initial");
  await mobileLinks.openURL("https://example.com");
  expect(forwarded).toEqual(["clipboard", "secret", "delete", "url"]);
  expect(calls).toHaveLength(0);
});

test("Windows context menus reach native selection and cancellation with item semantics intact", async () => {
  platform.OS = "windows";
  const items: import("../packages/context-menu/src/index").MenuItem[] = [{ type: "checkbox", id: "checked", label: "Checked", checked: true }, { type: "action", id: "disabled", label: "Disabled", disabled: true }, { type: "separator" }];
  const options = { windowId: "child", items, position: { x: 12.5, y: 40 } };
  handlers.set("NativeContextMenu.showMenu", args => {
    expect(JSON.parse(args[0])).toEqual([{ id: "checked", title: "Checked", checked: true, enabled: true }, { id: "disabled", title: "Disabled", enabled: false }, { separator: true }]);
    expect(JSON.parse(args[1])).toEqual({ x: 12.5, y: 40, windowId: "child" }); return "checked";
  });
  expect(await context.showContextMenu(options)).toEqual({ canceled: false, itemId: "checked" });
  handlers.set("NativeContextMenu.showMenu", () => "");
  expect(await context.showContextMenu(options)).toEqual({ canceled: true });
  handlers.set("NativeContextMenu.showMenu", () => { throw nativeError("E_BUSY"); });
  await expect(context.showContextMenu(options)).rejects.toMatchObject({ code: "E_BUSY" });
});
test("Windows dialogs retain four-button indices, parent selection and checkbox results", async () => {
  platform.OS = "windows";
  const options = { title: "Save", windowId: "child", buttons: [{ id: "cancel", label: "Cancel" }, { id: "ignore", label: "Ignore" }, { id: "save", label: "Save" }, { id: "other", label: "Other" }], defaultButtonId: "save", cancelButtonId: "cancel", checkbox: { label: "Remember", checked: true } };
  handlers.set("NativeDesktopMessageDialog.show", args => { expect(args).toEqual({ title: options.title, windowId: options.windowId, checkbox: options.checkbox, buttons: ["Cancel", "Ignore", "Save", "Other"], defaultButton: 2, cancelButton: 0 }); return { button: 2, checked: false }; });
  expect(await messages.showMessage(options)).toEqual({ buttonId: "save", checked: false });
  for (const code of ["E_BUSY", "E_NOT_FOUND"]) {
    handlers.set("NativeDesktopMessageDialog.show", () => { throw nativeError(code); });
    await expect(messages.showMessage(options)).rejects.toMatchObject({ code });
  }
});


test("Windows process validation accepts drive and UNC executables without allowing relative paths", async () => {
  platform.OS = "windows";
  const processes = await import("../packages/processes/src/index.ts");
  await processes.spawn({ target: { type: "executable", path: String.raw`C:\Program Files\tool.exe` }, cwd: String.raw`\\server\share\folder`, args: ['a"b', "", "space value"] });
  expect(calls.at(-1)).toMatchObject({ native: "NativeDesktopProcesses", method: "spawn", args: { executable: String.raw`C:\Program Files\tool.exe`, args: ['a"b', "", "space value"] } });
  await expect(processes.spawn({ target: { type: "executable", path: "tool.exe" } })).rejects.toThrow("absolute");
  await expect(processes.spawn({ target: { type: "executable", path: "C:tool.exe" } })).rejects.toThrow("absolute");
  await expect(processes.spawn({ target: { type: "executable", path: String.raw`C:\tool.exe` }, cwd: "relative" })).rejects.toThrow("absolute");
});

test("invalid Windows menu contributions leave the last good owner set intact", async () => {
  platform.OS = "windows";
  const base = await menus.createMenu({ id: "base", items: [{ type: "submenu", id: "file", label: "File", items: [{ type: "action", id: "open", label: "Open" }] }] });
  try {
    await expect(menus.createMenu({ id: "invalid-slider", items: [{ type: "submenu", id: "file", label: "File", items: [{ type: "slider", id: "volume", label: "Volume", min: 0, max: 1, value: 0.5 }] as unknown as import("../packages/native-menu/src/api").MenuItem[] }] })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    await expect(menus.createMenu({ id: "invalid", items: [{ type: "submenu", id: "bound", label: "File", target: { id: "missing" }, items: [] }] })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    const other = await menus.createMenu({ id: "other", items: [{ type: "submenu", id: "edit", label: "Edit", items: [] }] });
    const published = JSON.parse(calls.filter(call => call.method === "publish").at(-1)!.args[0]);
    expect(published[0].items.map((item: any) => item.id)).toEqual(["open"]);
    expect(published.map((item: any) => item.id)).toEqual(["file", "edit"]);
    await other.remove();
  } finally { await base.remove(); platform.OS = "macos"; }
});
test("recursive watch is explicit and retains removal semantics", async () => {
  let count = 0;
  const sub = await files.watch("/tree", () => count++, { recursive: true });
  const args = calls.at(-1)?.args; expect(args.recursive).toBe(true);
  emit("NativeDesktopFileSystem", "change", { id: args.id, path: "/tree" }); expect(count).toBe(1);
  await sub.remove(); emit("NativeDesktopFileSystem", "change", { id: args.id, path: "/tree" }); expect(count).toBe(1);
  await expect(files.watch("/tree", () => {}, { recursive: "yes" as never })).rejects.toThrow("boolean");
});

test("dialogs distinguish cancellation, malformed output and unavailable targets", async () => {
  for (const value of ["", "not-json", "{}", "[]", '[""]', '[7]', '["relative"]']) {
    handlers.set("NativeFileDialog.open", () => value);
    await expect(dialogs.openFileDialog()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  for (const value of ["", '""', "{}", "42"]) {
    handlers.set("NativeFileDialog.save", () => value);
    await expect(dialogs.saveFileDialog()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  handlers.set("NativeDesktopMessageDialog.show", () => ({ button: -1, checked: true }));
  expect(await messages.showMessage({ title: "Closed" })).toEqual({ buttonId: null, checked: true });
  handlers.set("NativeDesktopMessageDialog.show", () => ({ button: 9, checked: false }));
  await expect(messages.showMessage({ title: "Invalid" })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  platform.OS = "ios";
  expect(dialogs.getFileDialogAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(dialogs.openFileDialog()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(messages.showMessage({ title: "Unsupported" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});

test("file results validate shape and byte transport instead of trusting JSON casts", async () => {
  handlers.set("NativeDesktopFileSystem.stat", () => ({ type: "file", size: -1, modifiedAt: 0 }));
  await expect(files.stat("/file")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("NativeDesktopFileSystem.list", () => ["../escape"]);
  await expect(files.list("/directory")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("NativeDesktopFileSystem.list", () => ["z.txt", "a.txt"]);
  expect(await files.list("file:///tmp/space%20name")).toEqual([{ name: "a.txt", path: "/tmp/space name/a.txt" }, { name: "z.txt", path: "/tmp/space name/z.txt" }]);
  handlers.set("NativeDesktopFileSystem.readBytes", () => "!invalid!");
  await expect(files.readBytes("/file")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await expect(files.writeBytes("/file", "base64" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  handlers.set("NativeDesktopFileSystem.remove", () => false);
  expect(await files.remove("/absent")).toBeUndefined();
});
test("watch cleanup stops callbacks immediately and can retry a failed native unregister", async () => {
  const listener = vi.fn(); const watch = await files.watch("/file", listener);
  const id = calls.at(-1)!.args.id;
  handlers.set("NativeDesktopFileSystem.unwatch", () => { throw nativeError("E_IO"); });
  const first = watch.remove(); expect(watch.remove()).toBe(first);
  await expect(first).rejects.toMatchObject({ code: "E_NATIVE" });
  emit("NativeDesktopFileSystem", "change", { id, path: "/file" }); expect(listener).not.toHaveBeenCalled();
  handlers.delete("NativeDesktopFileSystem.unwatch"); await watch.remove(); await watch.remove();
  expect(calls.filter(call => call.method === "unwatch")).toHaveLength(2);
});

test("rich clipboard keeps binary transport private and preserves coexisting OS representations", async () => {
  handlers.set("NativeDesktopClipboard.read", () => ({ files: ["/tmp/file"], text: "file representation", imagePNG: new Uint8Array([0, 1, 255]).buffer }));
  expect(await clipboard.readClipboard()).toEqual({ files: ["/tmp/file"], text: "file representation", image: { format: "png", bytes: new Uint8Array([0, 1, 255]) } });
  await clipboard.writeClipboard({ image: { format: "png", bytes: new Uint8Array([0, 1, 255]) } });
  expect(calls.at(-1)?.args).toEqual({ bytes: new Uint8Array([0, 1, 255]) });
  handlers.set("NativeDesktopClipboard.read", () => ({ imagePNG: "!invalid!" }));
  await expect(clipboard.readClipboard()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("NativeDesktopSecureStorage.get", () => ({ unexpected: "value" }));
  await expect(secureStore.getItemAsync("key")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});


test("updater configuration validates every option before native side effects", async () => {
  for (const config of [{ automaticallyChecks: "yes" }, { checkIntervalSeconds: 0 }, { checkIntervalSeconds: Infinity }, { unknown: true }]) {
    await expect(updates.configureUpdates(config as never)).rejects.toThrow();
  }
  await expect(updates.checkForUpdates({ mode: "unknown" } as never)).rejects.toThrow();
  expect(calls).toHaveLength(0);
  await updates.configureUpdates({ automaticallyChecks: false, checkIntervalSeconds: 7200 });
  expect(calls.at(-1)?.args).toEqual({ automaticallyChecks: false, checkIntervalSeconds: 7200 });
  await updates.checkForUpdates({ mode: "background" }); expect(calls.at(-1)?.method).toBe("background");
});

test("updater rejects malformed native status/results and preserves busy causes", async () => {
  for (const status of [null, {}, { available: true, started: true }, { available: false, reason: "other" }]) {
    handlers.set("NativeDesktopUpdates.status", () => status);
    await expect(updates.getUpdateStatus()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  handlers.set("NativeDesktopUpdates.start", () => true);
  await expect(updates.startUpdates()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const cause = nativeError("E_BUSY");
  handlers.set("NativeDesktopUpdates.check", () => { throw cause; });
  await expect(updates.checkForUpdates()).rejects.toMatchObject({ code: "E_BUSY", cause });
});

test("updater subscriptions filter invalid events and unsupported platforms do not call native", async () => {
  const listener = vi.fn(); const sub = updates.onUpdateEvent(listener);
  for (const event of [null, {}, { type: "update", state: "bogus" }, { type: "update", state: "available", version: 1 }]) emit("NativeDesktopApp", "desktop", event);
  expect(listener).not.toHaveBeenCalled();
  emit("NativeDesktopApp", "desktop", { type: "update", state: "available", version: "2" });
  expect(listener).toHaveBeenCalledTimes(1); sub.remove(); sub.remove();
  emit("NativeDesktopApp", "desktop", { type: "update", state: "checking" }); expect(listener).toHaveBeenCalledTimes(1);
  platform.OS = "windows";
  expect(await updates.getUpdateStatus()).toMatchObject({ available: false, reason: "unsupported-platform" });
  await expect(updates.startUpdates()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(calls).toHaveLength(0);
});


test("notification permission distinguishes platform prompting and provisional authorization", async () => {
  for (const [raw, status, granted, canAskAgain] of [["notDetermined", "undetermined", false, true], ["denied", "denied", false, false], ["provisional", "granted", true, true], ["unknown", "unknown", false, null]]) {
    handlers.set("NativeDesktopNotifications.permission", () => raw);
    expect(await notifications.getNotificationPermission()).toEqual({ status, granted, canAskAgain, macos: { authorization: raw } });
  }
  platform.OS = "windows"; handlers.set("NativeDesktopNotifications.permission", () => "authorized");
  expect(await notifications.getNotificationPermission()).toEqual({ status: "granted", granted: true, canAskAgain: false });
});

test("notification scheduling validates trigger and content without partially submitting", async () => {
  for (const delaySeconds of [0, -1, NaN, Infinity, 315360001]) await expect(notifications.scheduleNotification({ id: "one", content: { title: "Title" }, trigger: { type: "delay", delaySeconds } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  for (const content of [{ title: "Title", data: { count: 1 } }, { title: "Title", sound: "yes" }, { title: "Title", sound: "bogus-tone" }, { title: "Title", subtitle: null }, { title: "Title", extra: true },
    { title: "Title", actions: [] }, { title: "Title", actions: [{ id: "a", label: "x" }, { id: "b", label: "y" }, { id: "c", label: "z" }, { id: "d", label: "w" }, { id: "e", label: "v" }] },
    { title: "Title", actions: [{ id: "open", label: "Reserved" }] }, { title: "Title", actions: [{ id: "a" }] }]) await expect(notifications.showNotification({ id: "one", content } as never)).rejects.toThrow();
  await expect(notifications.cancelNotification(null as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toHaveLength(0);
  await notifications.showNotification({ id: "one", content: { title: "Title" } });
  expect(calls.at(-1)?.args).toEqual({ id: "one", title: "Title", sound: "none" });
  await notifications.showNotification({ id: "one", content: { title: "Title", sound: "mail", actions: [{ id: "archive", label: "Archive" }, { id: "delete", label: "Delete" }] } });
  expect(calls.at(-1)?.args).toEqual({ id: "one", title: "Title", sound: "mail", actions: [{ id: "archive", label: "Archive" }, { id: "delete", label: "Delete" }] });
});

test("notifications reject invalid native output and preserve permission errors", async () => {
  handlers.set("NativeDesktopNotifications.permission", () => "maybe");
  await expect(notifications.getNotificationPermission()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("NativeDesktopNotifications.pending", () => ["valid", null]);
  await expect(notifications.getPendingNotifications()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const cause = nativeError("E_PERMISSION_DENIED");
  handlers.set("NativeDesktopNotifications.show", () => { throw cause; });
  await expect(notifications.showNotification({ id: "test", content: { title: "Title" } })).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", cause });
});

test("malformed response replay cleans listeners before rejecting", async () => {
  const listener = vi.fn();
  handlers.set("NativeDesktopNotifications.responses", () => [{ type: "notificationResponse", id: "bad" }]);
  await expect(notifications.onNotificationResponse(listener)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(listener).not.toHaveBeenCalled(); expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});

test("Windows response replay and live callbacks share validation and disposal", async () => {
  platform.OS = "windows";
  const event = { type: "notificationResponse", id: "event", notificationId: "notice", action: "open", data: {} };
  handlers.set("NativeDesktopApp.notificationResponses", () => { emit("NativeDesktopApp", "desktop", event); return [event]; });
  const listener = vi.fn(); const sub = await notifications.onNotificationResponse(listener);
  emit("NativeDesktopApp", "desktop", { ...event, id: "invalid", data: { invalid: 1 } });
  expect(listener).toHaveBeenCalledTimes(1); sub.remove(); sub.remove();
  emit("NativeDesktopApp", "desktop", { ...event, id: "later" }); expect(listener).toHaveBeenCalledTimes(1);
  platform.OS = "ios"; expect(notifications.getNotificationAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(notifications.getNotificationPermission()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});


test("shortcut cleanup stops callbacks before native completion and retries failures", async () => {
  for (const [register, moduleName, eventName] of [[shortcuts.registerShortcut, "NativeDesktopShortcuts", "shortcut"], [globalShortcuts.registerGlobalShortcut, "NativeDesktopGlobalShortcuts", "desktop"]] as const) {
    const handler = vi.fn(); const sub = await register("CmdOrCtrl+K", handler);
    const id = calls.at(-1)?.args.id;
    let fail = true;
    handlers.set(`${moduleName}.remove`, () => { if (fail) { fail = false; throw new Error("bridge busy"); } return null; });
    const removal = sub.remove(); expect(sub.remove()).toBe(removal);
    emit(moduleName === "NativeDesktopShortcuts" ? moduleName : "NativeDesktopApp", eventName, { type: "globalShortcut", id });
    expect(handler).not.toHaveBeenCalled(); await expect(removal).rejects.toMatchObject({ code: "E_NATIVE" });
    await sub.remove(); await sub.remove();
    expect(calls.filter(call => call.native === moduleName && call.method === "remove")).toHaveLength(2);
  }
});

test("shortcut options are validated before registration and native results are checked", async () => {
  for (const options of [{ windowId: "" }, { repeat: "yes" }, { unknown: true }]) await expect(shortcuts.registerShortcut("Cmd+K", () => {}, options as never)).rejects.toThrow();
  await expect(globalShortcuts.registerGlobalShortcut("Cmd+K", null as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  for (const options of [{ repeat: "yes" }, { unknown: true }]) await expect(globalShortcuts.registerGlobalShortcut("Cmd+K", () => {}, options as never)).rejects.toThrow();
  // macOS Carbon hotkeys never deliver repeats; asking for them is an unsupported option, not a silent no.
  await expect(globalShortcuts.registerGlobalShortcut("Cmd+K", () => {}, { repeat: true })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(0);
  handlers.set("NativeDesktopShortcuts.register", () => true);
  await expect(shortcuts.registerShortcut("Cmd+K", () => {})).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(subscriptions.get("NativeDesktopShortcuts.shortcut")?.size).toBe(0);
  expect(calls.at(-1)?.method).toBe("remove");
});


test("context menus reject invalid native selection and unsupported surface items", async () => {
  const options = { windowId: "main", position: { x: 0, y: 0 }, items: [{ type: "action" as const, id: "disabled", label: "Disabled", disabled: true }] };
  for (const result of [null, 5, "disabled", "unknown"]) {
    handlers.set("NativeContextMenu.showMenu", () => result);
    await expect(context.showContextMenu(options)).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  }
  calls.length = 0;
  await expect(context.showContextMenu({ ...options, items: [{ type: "submenu", id: "group", label: "Group", items: [] } as unknown as import("../packages/context-menu/src/index").MenuItem] })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  expect(calls).toHaveLength(0);
  handlers.set("NativeContextMenu.showMenu", () => { throw nativeError("E_NOT_FOUND"); });
  await expect(context.showContextMenu(options)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("tray removal joins, stops callbacks immediately and retries native failure", async () => {
  const actions: unknown[] = [];
  const item = await tray.createTray({ id: "test", title: "Test", onAction: event => actions.push(event) });
  handlers.set("NativeDesktopTray.remove", () => { throw nativeError("E_NATIVE"); });
  const first = item.remove(); expect(item.remove()).toBe(first);
  emit("NativeDesktopApp", "desktop", { type: "trayClick", trayId: "test", instanceId: calls[0].args.instanceId });
  await expect(first).rejects.toMatchObject({ code: "E_NATIVE" }); expect(actions).toEqual([]);
  handlers.delete("NativeDesktopTray.remove"); await item.remove(); await item.remove();
  expect(calls.filter(call => call.method === "remove")).toHaveLength(2);
});
test("tray snapshots accepted updates, filters actions and keeps last successful state", async () => {
  const actions: unknown[] = [];
  const options = { id: "test", title: "Initial", menu: [{ type: "action" as const, id: "open", label: "Open" }], onAction: (event: unknown) => actions.push(event) };
  const item = await tray.createTray(options); options.id = "changed";
  const changes = { menu: [{ type: "action" as const, id: "next", label: "Next" }] };
  const updating = item.update(changes); changes.menu[0].id = "mutated"; await updating;
  expect(calls.at(-1)!.args).toMatchObject({ id: "test", menu: [{ id: "next" }] });
  handlers.set("NativeDesktopTray.update", () => { throw nativeError("E_NATIVE"); });
  await expect(item.update({ title: "Failed" })).rejects.toThrow(); handlers.delete("NativeDesktopTray.update");
  await item.update({ tooltip: "Tooltip" });
  expect(calls.at(-1)!.args).toEqual({ id: "test", instanceId: calls[0].args.instanceId, tooltip: "Tooltip" });
  for (const itemId of ["open", "mutated", "next"]) emit("NativeDesktopApp", "desktop", { type: "trayAction", trayId: "test", instanceId: calls[0].args.instanceId, itemId });
  expect(actions).toEqual([{ type: "action", itemId: "next" }]);
  await expect(item.update({ id: "other" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await item.remove();
});
test("Windows tray ignores inactive macOS presentation and duplicate creation never removes its owner", async () => {
  platform.OS = "windows";
  const original = await tray.createTray({ id: "original", title: "Test", macos: { symbol: "star", unexpected: true } } as any);
  expect(calls[0]).toMatchObject({ native: "NativeDesktopTray", method: "create", args: { id: "original", title: "Test", symbol: "" } });
  await original.remove(); calls.length = 0;
  handlers.set("NativeDesktopTray.create", () => { throw nativeError("E_ALREADY_EXISTS"); });
  await expect(tray.createTray({ id: "test", title: "Test" })).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });
  expect(calls.map(call => call.method)).toEqual(["create"]);
});

test("system rejects malformed info and invalid options before changing native state", async () => {
  await expect(system.preventSleep({ reason: " ", kind: "system" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(system.requestAttention({ kind: "urgent" } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(system.setLaunchAtLogin("yes" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toHaveLength(0);
  handlers.set("NativeDesktopSystem.info", () => ({ osVersion: "15", architecture: "arm64", locale: "en", dark: false, idleSeconds: 0, onBattery: false, batteryLevel: 2 }));
  await expect(system.getSystemInfo()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("system subscriptions own independent native registrations and retry cleanup", async () => {
  const events: unknown[] = [];
  const first = await system.onSystemEvent(event => events.push(event));
  const firstId = calls.at(-1)!.args.id;
  const second = await system.onSystemEvent(event => events.push(event));
  const secondId = calls.at(-1)!.args.id; expect(firstId).not.toBe(secondId);
  handlers.set("NativeDesktopSystem.unobserve", () => { throw nativeError("E_NATIVE"); });
  const removing = first.remove(); expect(first.remove()).toBe(removing);
  emit("NativeDesktopApp", "desktop", { type: "wake", nativePrivate: true }); expect(events).toEqual([{ type: "wake" }]);
  await expect(removing).rejects.toMatchObject({ code: "E_NATIVE" });
  handlers.delete("NativeDesktopSystem.unobserve"); await first.remove(); await second.remove();
  expect(calls.filter(call => call.method === "unobserve").map(call => call.args.id)).toEqual([firstId, firstId, secondId]);
});
test("power and attention registrations join cleanup and retry failure", async () => {
  handlers.set("NativeDesktopSystem.preventSleep", () => 1);
  handlers.set("NativeDesktopSystem.attention", () => -1);
  const blocker = await system.preventSleep({ reason: "Export", kind: "system" });
  const attention = await system.requestAttention({ kind: "critical" });
  handlers.set("NativeDesktopSystem.allowSleep", () => { throw nativeError("E_NATIVE"); });
  const removing = blocker.remove(); expect(blocker.remove()).toBe(removing);
  await expect(removing).rejects.toThrow(); handlers.delete("NativeDesktopSystem.allowSleep");
  await blocker.remove(); await attention.remove(); await attention.remove();
  expect(calls.filter(call => call.method === "allowSleep")).toHaveLength(2);
  expect(calls.filter(call => call.method === "cancelAttention")).toHaveLength(1);
});
test("launcher menus stop callbacks on failed removal and enforce surface support", async () => {
  let selected = 0;
  const menu = await system.createDockMenu({ items: [{ type: "action", id: "open", label: "Open" }], onAction: () => selected++ });
  const owner = calls.at(-1)!.args.owner;
  handlers.set("NativeDesktopSystem.clearDockMenu", () => { throw nativeError("E_NATIVE"); });
  const removing = menu.remove(); emit("NativeDesktopApp", "desktop", { type: "dockAction", owner, id: "open" }); expect(selected).toBe(0);
  await expect(removing).rejects.toThrow(); handlers.delete("NativeDesktopSystem.clearDockMenu"); await menu.remove();
  await expect(system.createTaskbarMenu({ items: [], onAction: () => {} })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  platform.OS = "windows";
  await expect(system.createDockMenu({ items: [], onAction: () => {} })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(system.createTaskbarMenu({ items: [{ type: "submenu", id: "sub", label: "Sub", items: [] }], onAction: () => {} } as any)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});

test("application menu updates snapshot inputs, serialize and retain last successful owners", async () => {
  const received: unknown[] = [];
  const item = await menus.createMenu({ id: "queued", items: [], onAction: event => received.push(event) });
  let finish!: () => void;
  handlers.set("NativeMenu.publish", () => new Promise<void>(resolve => { finish = resolve; }));
  const items: import("../packages/native-menu/src/api").MenuRootItem[] = [{ type: "submenu", id: "file", label: "Before", items: [{ type: "action", id: "open", label: "Open" }] }];
  const update = item.update({ items }); if (items[0].type === "submenu") items[0].label = "After";
  await tick(); expect(JSON.parse(calls.at(-1)!.args[0])[0].title).toBe("Before");
  const token = JSON.parse(calls.at(-1)!.args[0])[0]._sparkOwner;
  const removal = item.remove(); expect(item.remove()).toBe(removal);
  emit("NativeMenu", "NativeMenuAction", { ownerId: token, itemId: "open" }); expect(received).toEqual([]);
  handlers.delete("NativeMenu.publish"); finish(); await Promise.all([update, removal]);
  expect(JSON.parse(calls.at(-1)!.args[0])).toEqual([]);
  await expect(item.update({ items: [] })).rejects.toMatchObject({ code: "E_CLOSED" });
});
test("application menu duplicates preserve owners and failed removal can retry", async () => {
  const menu = await menus.createMenu({ id: "test", items: [] });
  const before = calls.length;
  await expect(menus.createMenu({ id: "test", items: [] })).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" }); expect(calls.length).toBe(before);
  handlers.set("NativeMenu.publish", () => { throw nativeError("E_NATIVE"); });
  await expect(menu.remove()).rejects.toMatchObject({ code: "E_NATIVE" });
  handlers.delete("NativeMenu.publish"); await menu.remove();
  const replacement = await menus.createMenu({ id: "test", items: [] }); await replacement.remove();
});
test("failed native menu updates do not commit proposed owner state", async () => {
  platform.OS = "windows";
  const menu = await menus.createMenu({ id: "test", items: [{ type: "submenu", id: "file", label: "File", items: [] }] });
  handlers.set("NativeMenu.publish", () => { throw nativeError("E_NATIVE"); });
  await expect(menu.update({ items: [{ type: "submenu", id: "bad", label: "Bad", items: [] }] })).rejects.toThrow();
  handlers.delete("NativeMenu.publish");
  const other = await menus.createMenu({ id: "other", items: [{ type: "submenu", id: "edit", label: "Edit", items: [] }] });
  expect(JSON.parse(calls.at(-1)!.args[0]).map((item: any) => item.id)).toEqual(["file", "edit"]);
  await other.remove(); await menu.remove();
});

test("document requests decode paths once and reject malformed replay without leaking listeners", async () => {
  handlers.set("NativeDesktopApp.pendingURLs", () => [{ type: "openFile", id: "f", url: "file:///tmp/a%2520%23.txt" }]);
  const events: unknown[] = [];
  const sub = await documents.subscribeToOpenRequests(event => events.push(event));
  expect(events).toEqual([{ type: "file", id: "f", path: "/tmp/a%20#.txt" }]);
  emit("NativeDesktopApp", "desktop", { type: "openFile", id: "bad", url: "file:///tmp/a?query=bad" }); expect(events).toHaveLength(1); sub.remove();
  handlers.set("NativeDesktopApp.pendingURLs", () => [{ type: "openURL", id: "bad", url: 123 }]);
  await expect(documents.subscribeToOpenRequests(() => {})).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});
test("document request replay deduplicates even a busy live stream while the snapshot is pending", async () => {
  handlers.set("NativeDesktopApp.pendingURLs", () => {
    for (let i = 0; i < 250; i++) emit("NativeDesktopApp", "desktop", { type: "openURL", id: `event-${i}`, url: `demo://${i}` });
    return [{ type: "openURL", id: "event-0", url: "demo://0" }];
  });
  let events = 0; const sub = await documents.subscribeToOpenRequests(() => events++);
  expect(events).toBe(250); sub.remove();
});
test("recent documents and openPath accept native paths without URL interpolation", async () => {
  await documents.noteRecentDocument("/tmp/a #%.txt"); expect(calls.at(-1)!.args).toEqual({ path: "/tmp/a #%.txt" });
  await links.openPath("file:///tmp/a%20%23%25.txt"); expect(calls.at(-1)!).toMatchObject({ method: "openPath", args: { path: "/tmp/a #%.txt" } });
  handlers.set("NativeDesktopLinks.recent", () => ["/tmp/a\\b.txt"]);
  expect(await documents.getRecentDocuments()).toEqual([{ path: "/tmp/a\\b.txt", name: "a\\b.txt" }]);
  handlers.set("NativeDesktopLinks.recent", () => ["relative"]);
  await expect(documents.getRecentDocuments()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("NativeDesktopLinks.canOpen", () => "yes");
  await expect(links.canOpenURL("demo://test")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});


test("tray image inputs are portable and delayed actions cannot reach a reused ID", async () => {
  const firstActions = vi.fn(), nextActions = vi.fn();
  const first = await tray.createTray({ id: "image", image: { path: "file:///tmp/icon.png" }, onAction: firstActions });
  const retired = calls.at(-1)!.args.instanceId;
  expect(calls.at(-1)!.args.imagePath).toBe("/tmp/icon.png");
  await expect(first.update({ macos: { symbol: "star" } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await first.remove();
  const next = await tray.createTray({ id: "image", title: "Next", onAction: nextActions });
  const current = calls.at(-1)!.args.instanceId; expect(current).not.toBe(retired);
  emit("NativeDesktopApp", "desktop", { type: "trayClick", trayId: "image", instanceId: retired }); expect(nextActions).not.toHaveBeenCalled();
  emit("NativeDesktopApp", "desktop", { type: "trayClick", trayId: "image", instanceId: current }); expect(nextActions).toHaveBeenCalledExactlyOnceWith({ type: "click" });
  await next.remove(); expect(calls.at(-1)!.args).toEqual({ id: "image", instanceId: current });
  platform.OS = "windows";
  const windows = await tray.createTray({ id: "windows", image: { path: "C:\\Icons\\tray.png" } }); await windows.remove();
});
