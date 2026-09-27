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
      const method = key === "call" ? args[0] : String(key);
      const value = key === "call" ? JSON.parse(args[1]) : args;
      calls.push({ native: name, method, args: value });
      const result = await handlers.get(`${name}.${method}`)?.(value);
      return key === "call" ? JSON.stringify(result ?? null) : result;
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
const windows = await import("../packages/desktop-windows/src/index.ts");
const files = await import("../packages/file-system/src/index.ts");
const clipboard = await import("../packages/clipboard/src/index.ts");
const links = await import("../packages/desktop-links/src/index.ts");
const secureStore = await import("../packages/secure-storage/src/index.ts");
const shortcuts = await import("../packages/desktop-shortcuts/src/index.ts");
const menus = await import("../packages/native-menu/src/index.ts");
const context = await import("../packages/context-menu/src/index.ts");
const dialogs = await import("../packages/file-dialog/src/index.ts");
beforeEach(() => { platform.OS = "macos"; calls.length = 0; handlers.clear(); subscriptions.clear(); });
const tick = () => sleep(1);
function nativeError(code: string) { return Object.assign(new Error(code), { code }); }

test("app context, activation, hide and quit call the native host", async () => {
  handlers.set("NativeDesktopApp.context", () => ({ projectId: "a" }));
  expect((await app.getAppContext()).projectId).toBe("a");
  await app.activate(); await app.hide(); await app.quit();
  expect(calls.map(call => call.method)).toEqual(["context", "activate", "hide", "quit"]);
});
test("quit guards aggregate async result, reject duplicate registration and dispose once", async () => {
  const guard = await app.beforeQuit(async () => true);
  await expect(app.beforeQuit(() => true)).rejects.toThrow("already registered");
  emit("NativeDesktopApp", "desktop", { type: "beforeQuit" }); await tick();
  expect(calls.find(call => call.method === "replyQuit")?.args.allow).toBe(true);
  await guard.remove(); await guard.remove();
  expect(calls.filter(call => call.method === "quitGuard" && !call.args.enabled)).toHaveLength(1);
});
test("throwing or disposed quit guards cancel instead of discarding edits", async () => {
  let guard = await app.beforeQuit(() => { throw new Error("save failed"); });
  emit("NativeDesktopApp", "desktop", { type: "beforeQuit" }); await tick();
  expect(calls.find(call => call.method === "replyQuit")?.args.allow).toBe(false); await guard.remove();
  let finish!: (allow: boolean) => void;
  guard = await app.beforeQuit(() => new Promise<boolean>(resolve => { finish = resolve; }));
  emit("NativeDesktopApp", "desktop", { type: "beforeQuit" }); await tick(); await guard.remove(); finish(true); await tick();
  expect(calls.filter(call => call.method === "replyQuit").at(-1)?.args.allow).toBe(false);
});
test("failed guard registration cleans listeners and permits retry", async () => {
  handlers.set("NativeDesktopApp.quitGuard", () => { throw new Error("bridge"); });
  await expect(app.beforeQuit(() => true)).rejects.toThrow("bridge");
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
  handlers.delete("NativeDesktopApp.quitGuard"); await (await app.beforeQuit(() => true)).remove();
});
test("windows validate ids and finite frame sizes before crossing the bridge", () => {
  for (const id of ["", "../window", "main", "x".repeat(101)]) expect(() => windows.openWindow({ id })).toThrow();
  for (const width of [0, NaN, Infinity, 99, 20001]) expect(() => windows.openWindow({ id: "test", width })).toThrow();
  expect(() => windows.setWindowFrame("main", { x: NaN, y: 0, width: 400, height: 400 })).toThrow();
  expect(calls).toHaveLength(0);
});
test("window commands serialize explicit window identity and properties", async () => {
  await windows.openWindow({ id: "secondary", props: { route: "settings" } }); await windows.getWindow(); await windows.listWindows(); await windows.getDisplays();
  await windows.setWindowTitle("secondary", "Settings"); await windows.setWindowFrame("secondary", { x: 1, y: 2, width: 500, height: 300 });
  await windows.minimizeWindow("secondary"); await windows.setFullscreen("secondary", true); await windows.hideWindow("secondary"); await windows.showWindow("secondary"); await windows.closeWindow("secondary");
  expect(calls[0]?.args.props).toEqual({ route: "settings" }); expect(calls[1]?.args.id).toBe("main");
  expect(calls.map(call => call.method)).toEqual(["open", "info", "list", "displays", "title", "frame", "minimize", "fullscreen", "hide", "show", "close"]);
});
test("window close guards handle only their window and coalesce repeated requests", async () => {
  let requests = 0; let finish!: (allow: boolean) => void;
  const guard = await windows.beforeWindowClose("test", () => { requests++; return new Promise<boolean>(resolve => { finish = resolve; }); });
  emit("NativeDesktopApp", "desktop", { type: "beforeClose", windowId: "other" });
  emit("NativeDesktopApp", "desktop", { type: "beforeClose", windowId: "test", requestId: 1 });
  emit("NativeDesktopApp", "desktop", { type: "beforeClose", windowId: "test", requestId: 1 }); await tick(); expect(requests).toBe(1);
  finish(false); await tick(); expect(calls.find(call => call.method === "replyClose")?.args).toEqual({ id: "test", requestId: 1, allow: false });
  await guard.remove();
});
test("new close requests supersede expired handlers without losing request identity", async () => {
  const finish: ((allow: boolean) => void)[] = [];
  const guard = await windows.beforeWindowClose("expiry", () => new Promise<boolean>(resolve => finish.push(resolve)));
  emit("NativeDesktopApp", "desktop", { type: "beforeClose", windowId: "expiry", requestId: 10 }); await tick();
  emit("NativeDesktopApp", "desktop", { type: "beforeClose", windowId: "expiry", requestId: 11 }); await tick();
  expect(finish).toHaveLength(2);
  finish[0]!(true); await tick();
  emit("NativeDesktopApp", "desktop", { type: "beforeClose", windowId: "expiry", requestId: 11 }); await tick();
  expect(finish).toHaveLength(2);
  await guard.remove(); finish[1]!(true); await tick();
  expect(calls.filter(call => call.method === "replyClose").map(call => call.args)).toEqual([
    { id: "expiry", requestId: 10, allow: true }, { id: "expiry", requestId: 11, allow: false },
  ]);
});
test("filesystem errors preserve permission failures instead of pretending files are absent", async () => {
  handlers.set("NativeDesktopFileSystem.stat", () => { throw nativeError("E_NOT_FOUND"); }); expect(await files.exists("/missing")).toBe(false);
  handlers.set("NativeDesktopFileSystem.stat", () => { throw nativeError("E_PERMISSION"); }); await expect(files.exists("/protected")).rejects.toThrow("E_PERMISSION");
  await expect(files.readText("relative")).rejects.toThrow("absolute"); await expect(files.writeText("/a\0b", "text")).rejects.toThrow();
});
test("filesystem binary and mutation APIs preserve paths and opt-in recursive deletion", async () => {
  handlers.set("NativeDesktopFileSystem.directory", () => "/data");
  handlers.set("NativeDesktopFileSystem.readText", () => "text");
  handlers.set("NativeDesktopFileSystem.readBytes", () => "AA==");
  handlers.set("NativeDesktopFileSystem.list", () => ["a"]);
  handlers.set("NativeDesktopFileSystem.remove", () => true);
  await files.getDirectory("data"); await files.readText("file:///tmp/a%20b"); await files.writeText("/a", "text"); await files.readBytes("/a"); await files.writeBytes("/b", new Uint8Array([0]));
  await files.mkdir("/dir"); await files.list("/dir"); await files.copy("/a", "/b"); await files.move("/b", "/c"); await files.remove("/dir"); await files.remove("/dir", { recursive: true });
  expect(calls[1]?.args.path).toBe("/tmp/a b"); expect(calls.filter(call => call.method === "remove").map(call => call.args.recursive)).toEqual([false, true]);
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
  expect(await clipboard.getStringAsync()).toBe(""); expect(await clipboard.hasStringAsync()).toBe(false); await clipboard.setStringAsync("hello");
  expect(await secureStore.getItemAsync("key")).toBeNull(); await secureStore.setItemAsync("key", ""); expect(calls.at(-1)?.args.value).toBe(""); await secureStore.deleteItemAsync("key");
  await expect(secureStore.getItemAsync("")).rejects.toThrow(); await expect(secureStore.getItemAsync("x".repeat(201))).rejects.toThrow();
});
test("links deduplicate queued/live overlap and stop delivery on removal", async () => {
  const cold = { type: "openURL" as const, id: "cold", url: "demo://cold" };
  handlers.set("NativeDesktopApp.pendingURLs", () => { emit("NativeDesktopApp", "desktop", cold); return [cold]; });
  const received: import("../packages/desktop-links/src/index").OpenEvent[] = []; const sub = await links.onOpen(event => received.push(event)); expect(received).toEqual([cold]);
  emit("NativeDesktopApp", "desktop", { type: "focus" }); expect(received).toHaveLength(1);
  sub.remove(); emit("NativeDesktopApp", "desktop", { ...cold, id: "warm" }); expect(received).toHaveLength(1);
});
test("links registration failures clean up listeners and URL validation is early", async () => {
  handlers.set("NativeDesktopApp.pendingURLs", () => { throw new Error("bridge"); });
  await expect(links.onOpen(() => {})).rejects.toThrow("bridge"); expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
  await expect(links.openURL("example.com")).rejects.toThrow("scheme"); expect(await links.openURL("https://example.com")).toBe(true); await links.canOpenURL("demo://test"); await links.noteRecentDocument("file:///tmp/a"); await links.getRecentDocuments(); await links.clearRecentDocuments();
});
test("shortcuts dispatch only their registration and clean up on failure/removal", async () => {
  let count = 0; const sub = await shortcuts.registerShortcut("Cmd+K", () => { count++; }); const id = calls[0]?.args.id;
  emit("NativeDesktopShortcuts", "shortcut", { id: "other" }); emit("NativeDesktopShortcuts", "shortcut", { id }); expect(count).toBe(1);
  await sub.remove(); await sub.remove(); emit("NativeDesktopShortcuts", "shortcut", { id }); expect(count).toBe(1);
  handlers.set("NativeDesktopShortcuts.register", () => { throw nativeError("E_SHORTCUT_CONFLICT"); });
  await expect(shortcuts.registerShortcut("Cmd+K", () => {})).rejects.toThrow(); expect(subscriptions.get("NativeDesktopShortcuts.shortcut")?.size).toBe(0);
});
test("context menus validate location, duplicate ids and cancellation", async () => {
  await expect(context.showContextMenu([], { x: NaN, y: 0 })).rejects.toThrow("finite");
  await expect(context.showContextMenu([{ id: "x", title: "A" }, { id: "x", title: "B" }], { x: 0, y: 0 })).rejects.toThrow("unique");
  handlers.set("NativeContextMenu.showMenu", () => ""); expect(await context.showContextMenu([], { x: 0, y: 0 })).toBeNull();
  handlers.set("NativeContextMenu.showMenu", () => "selected"); expect(await context.showContextMenu([{ id: "selected", title: "Select" }], { x: 0, y: 0 })).toBe("selected");
});
test("dialogs parse selected paths and native cancellation, preserving save conflicts", async () => {
  handlers.set("NativeFileDialog.open", () => '["/tmp/example.txt"]'); expect(await dialogs.openFileDialog()).toEqual({ canceled: false, paths: ["/tmp/example.txt"] });
  handlers.set("NativeFileDialog.open", () => "null"); expect(await dialogs.openFileDialog()).toEqual({ canceled: true });
  handlers.set("NativeFileDialog.save", () => '"/tmp/save.txt"'); expect(await dialogs.saveFileDialog()).toEqual({ canceled: false, path: "/tmp/save.txt" });
  handlers.set("NativeDesktopFileSystem.writeTextIfUnchanged", () => false); expect(await files.writeTextIfUnchanged("/a", "old", "new")).toEqual({ written: false });
  handlers.set("NativeDesktopFileSystem.readText", () => "text"); expect(await files.readText("/a")).toBe("text"); await files.writeText("/a", "new");
  await files.revealInFileManager("/a");
});
test("menu owner ids and patch payloads survive native transport", async () => {
  const configuration = [{ id: "file", title: "File", items: [{ id: "save", title: "Save", checked: true }] }];
  menus.configureMenus("owner", configuration); menus.updateMenuItems("owner", [{ id: "save", enabled: false }]); menus.clearMenus("owner"); menus.clearAllMenus();
  expect(calls[0]?.args).toEqual(["owner", JSON.stringify(configuration)]); expect(calls.map(call => call.method)).toEqual(["configureMenus", "updateMenuItems", "clearMenus", "clearAllMenus"]);
  let received: unknown; const sub = menus.addNativeMenuActionListener(event => { received = event; }); const event = { ownerId: "owner", menuId: "file", itemId: "save" };
  emit("NativeMenu", "NativeMenuAction", event); expect(received).toEqual(event); sub.remove();
});

test("notifications validate before transport and distinguish permission reads from prompts", async () => {
  for (const notification of [{ id: "../bad", content: { title: "test" } }, { id: "test", content: { title: " " } }, { id: "test", content: { title: "test" }, delay: 0 }]) await expect(notifications.showNotification(notification)).rejects.toThrow();
  expect(calls).toHaveLength(0);
  handlers.set("NativeDesktopNotifications.permission", () => "authorized");
  handlers.set("NativeDesktopNotifications.requestPermission", () => "authorized");
  expect(await notifications.getNotificationPermission()).toMatchObject({ status: "granted", granted: true }); await notifications.requestNotificationPermission();
  await notifications.scheduleNotification({ id: "test", content: { title: "Hello", data: { route: "inbox" } }, trigger: { type: "delay", delaySeconds: 2 } });
  expect(calls.at(-1)?.args).toEqual({ id: "test", title: "Hello", data: { route: "inbox" }, sound: false, delay: 2 });
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
  await expect(tray.createTray({ id: "x", title: "X", menu: [{ id: "a", title: "A" }, { id: "a", title: "B" }] })).rejects.toThrow("unique");
  handlers.set("NativeDesktopTray.create", () => { throw nativeError("E_TRAY_EXISTS"); });
  await expect(tray.createTray({ id: "x", title: "X" })).rejects.toThrow("E_TRAY_EXISTS");
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});
test("tray scopes actions, serializes updates and waits before removing", async () => {
  const actions: unknown[] = []; const item = await tray.createTray({ id: "test", symbol: "star" }, event => actions.push(event));
  emit("NativeDesktopApp", "desktop", { type: "trayClick", trayId: "other" });
  emit("NativeDesktopApp", "desktop", { type: "trayAction", trayId: "test", itemId: "open" }); expect(actions).toHaveLength(1);
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
  handlers.set("NativeDesktopGlobalShortcuts.register", () => { throw nativeError("E_SHORTCUT_CONFLICT"); });
  await expect(globalShortcuts.registerGlobalShortcut("Cmd+Shift+K", () => {})).rejects.toThrow("E_SHORTCUT_CONFLICT");
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(1); await second.remove();
});
test("process subscriptions exist before launch and survive immediate exit", async () => {
  handlers.set("NativeDesktopProcesses.spawn", args => {
    emit("NativeDesktopApp", "desktop", { type: "processOutput", processId: args.id, stream: "stdout", base64: "aGk=" });
    emit("NativeDesktopApp", "desktop", { type: "processExit", processId: args.id, result: { exitCode: 0, stdout: "hi" } });
  });
  const chunks: string[] = [];
  const child = await processes.spawn({ executable: "/bin/echo", args: ["hi"] }, chunk => chunks.push(chunk.base64));
  expect(await child.exited).toMatchObject({ stdout: "hi", exitCode: 0 }); expect(chunks).toEqual(["aGk="]);
  expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0); await child.terminate();
  await expect(child.write("late")).rejects.toThrow("exited");
});
test("process validation and failed launches do not leak listeners", async () => {
  for (const options of [{ executable: "echo" }, { executable: "helper:../escape" }, { executable: "helper:" }, { executable: "/bin/echo", input: 123 as never }, { executable: "/bin/echo", timeoutMs: -1 }, { executable: "/bin/echo", env: { "BAD=KEY": "x" } }]) await expect(processes.spawn(options)).rejects.toThrow();
  handlers.set("NativeDesktopProcesses.spawn", () => { throw nativeError("E_NOT_FOUND"); });
  await expect(processes.spawn({ executable: "/missing" })).rejects.toThrow("E_NOT_FOUND"); expect(subscriptions.get("NativeDesktopApp.desktop")?.size).toBe(0);
});
test("dialog cancellation, default buttons and input validation", async () => {
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
  const assertion = await system.preventSleep("Exporting"); await assertion.remove(); await assertion.remove();
  expect(calls.filter(call => call.method === "allowSleep")).toHaveLength(1);
  const events: string[] = []; const subscription = await system.onSystemEvent(event => events.push(event.type));
  emit("NativeDesktopApp", "desktop", { type: "wake" }); emit("NativeDesktopApp", "desktop", { type: "activate" }); expect(events).toEqual(["wake"]); subscription.remove();
});
test("window styling uses the same constraints as startup config", async () => {
  expect(() => windows.setWindowOptions("main", { minWidth: 1000, maxWidth: 400 })).toThrow();
  expect(() => windows.openWindow({ id: "sheet", modal: true })).toThrow();
  await windows.setWindowOptions("main", { titleBarStyle: "overlay", resizable: false });
  expect(calls.at(-1)?.args).toEqual({ id: "main", options: { titleBarStyle: "overlay", resizable: false } });
});
test("Dock menus identify their owner and remove only once", async () => {
  const selected: string[] = [];
  const menu = await system.setDockMenu([{ id: "open", title: "Open" }], id => selected.push(id));
  const owner = calls.at(-1)?.args.owner;
  emit("NativeDesktopApp", "desktop", { type: "dockAction", owner: "other", id: "open" });
  emit("NativeDesktopApp", "desktop", { type: "dockAction", owner, id: "open" }); expect(selected).toEqual(["open"]);
  await menu.remove(); await menu.remove(); expect(calls.filter(call => call.method === "clearDockMenu")).toHaveLength(1);
});

test("Expo clipboard subset handles formats, boolean results, and native failures", async () => {
  handlers.set("NativeDesktopClipboard.getString", args => args.format === "html" ? "<b>Hello</b>" : "Hello");
  handlers.set("NativeDesktopClipboard.hasString", () => true);
  expect(await clipboard.getStringAsync()).toBe("Hello");
  expect(await clipboard.getStringAsync({ preferredFormat: clipboard.StringFormat.HTML })).toBe("<b>Hello</b>");
  expect(await clipboard.setStringAsync("<b>Hello</b>", { inputFormat: clipboard.StringFormat.HTML })).toBe(true);
  expect(calls.at(-1)?.args).toEqual({ text: "<b>Hello</b>", format: "html" });
  expect(await clipboard.hasStringAsync()).toBe(true);
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

test("Windows shared adapters dispatch rich formats to native backends", async () => {
  platform.OS = "windows";
  const win = await import("../packages/clipboard/src/index.windows.ts");
  const store = await import("../packages/secure-storage/src/index.windows.ts");
  const linking = await import("../packages/desktop-links/src/index.windows.ts");
  handlers.set("NativeDesktopClipboard.getString", () => "Windows text");
  expect(await win.getStringAsync()).toBe("Windows text");
  expect(await win.setStringAsync("hello")).toBe(true);
  await win.writeClipboard({ html: "<b>rich</b>", rtf: "{\\rtf1 rich}", image: { format: "png", bytes: new Uint8Array([1, 2]) } });
  expect(calls.at(-1)).toMatchObject({ native: "NativeDesktopClipboard", method: "write", args: { html: "<b>rich</b>", imagePNG: "AQI=" } });
  await win.writeClipboard({ files: [String.raw`C:\Users\test\file.txt`, String.raw`\\server\share\file.txt`] });
  await expect(win.writeClipboard({ files: ["relative.txt"] })).rejects.toThrow("absolute path");
  handlers.set("NativeDesktopClipboard.write", () => { throw nativeError("E_CLIPBOARD"); });
  await expect(win.writeClipboard({ image: { format: "png", bytes: new Uint8Array([1]) } })).rejects.toMatchObject({ code: "E_NATIVE", cause: { code: "E_CLIPBOARD" } });
  await store.setItemAsync("sample", "value");
  expect(calls.at(-1)?.native).toBe("NativeDesktopSecureStorage");
  handlers.set("NativeDesktopLinks.canOpen", () => true);
  expect(await linking.canOpenURL("https://example.com")).toBe(true);
  await expect(linking.canOpenURL("invalid")).rejects.toThrow("scheme");
});

test("Windows context menus reach native selection and cancellation with item semantics intact", async () => {
  platform.OS = "windows";
  const items = [{ id: "checked", title: "Checked", checked: true }, { id: "disabled", title: "Disabled", enabled: false }, { id: "sep", title: "", separator: true }];
  handlers.set("NativeContextMenu.showMenu", args => {
    expect(JSON.parse(args[0])).toEqual(items); expect(JSON.parse(args[1])).toEqual({ x: 12.5, y: 40 }); return "checked";
  });
  expect(await context.showContextMenu(items, { x: 12.5, y: 40 })).toBe("checked");
  handlers.set("NativeContextMenu.showMenu", () => "");
  expect(await context.showContextMenu(items, { x: 0, y: 0 })).toBeNull();
  handlers.set("NativeContextMenu.showMenu", () => { throw nativeError("E_BUSY"); });
  await expect(context.showContextMenu(items, { x: 0, y: 0 })).rejects.toMatchObject({ code: "E_BUSY" });
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
  await processes.spawn({ executable: String.raw`C:\Program Files\tool.exe`, cwd: String.raw`\\server\share\folder`, args: ['a"b', "", "space value"] });
  expect(calls.at(-1)).toMatchObject({ native: "NativeDesktopProcesses", method: "spawn", args: { executable: String.raw`C:\Program Files\tool.exe`, args: ['a"b', "", "space value"] } });
  await expect(processes.spawn({ executable: "tool.exe" })).rejects.toThrow("absolute");
  await expect(processes.spawn({ executable: "C:tool.exe" })).rejects.toThrow("absolute");
  await expect(processes.spawn({ executable: String.raw`C:\tool.exe`, cwd: "relative" })).rejects.toThrow("cwd");
});

test("invalid Windows menu contributions leave the last good owner set intact", () => {
  platform.OS = "windows";
  try {
    menus.clearAllMenus();
    menus.configureMenus("base", [{ id: "file", title: "File", items: [{ id: "open", title: "Open" }] }]);
    expect(() => menus.configureMenus("invalid", [{ id: "file", title: "File", items: [{ id: "bad", targetPath: ["Recent", "Clear"] }] }])).toThrow("nested targetPath");
    menus.configureMenus("other", [{ id: "edit", title: "Edit", items: [] }]);
    const published = JSON.parse(calls.filter(call => call.method === "configureMenus").at(-1)!.args[1]);
    expect(published[0].items.map((item: any) => item.id)).toEqual(["open"]);
    expect(published.some((menu: any) => menu.items.some((item: any) => item._sparkOwner === "invalid"))).toBe(false);
    menus.clearAllMenus();
  } finally { platform.OS = "macos"; }
});

test("overlay windows use portable defaults and reject modality", async () => {
  await windows.openWindow({ id: "overlay-probe", kind: "overlay", width: 340, height: 140 });
  expect(calls.at(-1)?.args).toMatchObject({ kind: "overlay", titleBarStyle: "borderless", transparent: true, hasShadow: false, alwaysOnTop: true, resizable: false, minimizable: false });
  expect(() => windows.openWindow({ id: "overlay-probe", kind: "overlay", parentId: "main", modal: true })).toThrow("cannot be modal");
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
  handlers.set("NativeDesktopClipboard.read", () => ({ files: ["/tmp/file"], text: "file representation", imagePNG: "AAH/" }));
  expect(await clipboard.readClipboard()).toEqual({ files: ["/tmp/file"], text: "file representation", image: { format: "png", bytes: new Uint8Array([0, 1, 255]) } });
  await clipboard.writeClipboard({ image: { format: "png", bytes: new Uint8Array([0, 1, 255]) } });
  expect(calls.at(-1)?.args).toEqual({ imagePNG: "AAH/" });
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
  for (const content of [{ title: "Title", data: { count: 1 } }, { title: "Title", sound: "yes" }, { title: "Title", subtitle: null }, { title: "Title", extra: true }]) await expect(notifications.showNotification({ id: "one", content } as never)).rejects.toThrow();
  await expect(notifications.cancelNotification(null as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toHaveLength(0);
  await notifications.showNotification({ id: "one", content: { title: "Title" } });
  expect(calls.at(-1)?.args).toEqual({ id: "one", title: "Title", sound: false });
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
