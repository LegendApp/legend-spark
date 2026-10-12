import { useEffect, useState, useSyncExternalStore } from "react";
import { createMenu, getMenuAvailability, type Menu, type MenuRootItem } from "@legendapp/spark/menus";
import { createShortcutMap, getShortcutMapAvailability, type ShortcutCommand, type ShortcutMap, type ShortcutMapScope } from "@legendapp/spark/shortcuts/commands";
import type { AsyncRegistration } from "@legendapp/spark/shortcuts";
import { errorText } from "../../Panel";
import type { ShortcutMapMessages } from "./shortcut-map-messages";

// The demo's commands cover every scope. clear-console defaults to ⌘⇧K, which the app controller
// already registers with registerShortcut, so the screen opens with a live conflict to show.
export const DEMO_COMMANDS = [
  { id: "new-note", title: "New note", defaultBindings: ["CmdOrCtrl+N"] },
  { id: "open-recent", title: "Open recent", defaultBindings: ["CmdOrCtrl+Shift+O"] },
  { id: "find", title: "Find", defaultBindings: ["CmdOrCtrl+F"], scope: "window" },
  { id: "toggle-sidebar", title: "Toggle sidebar", defaultBindings: ["CmdOrCtrl+Alt+S"], scope: "window" },
  { id: "bold", title: "Bold", defaultBindings: ["CmdOrCtrl+B"], scope: "view" },
  { id: "clear-console", title: "Clear console", defaultBindings: ["CmdOrCtrl+Shift+K"], scope: "view" },
  { id: "quick-capture", title: "Quick capture", defaultBindings: ["CmdOrCtrl+Shift+F17"], scope: "global" },
] as const satisfies readonly ShortcutCommand[];
export type DemoCommandId = typeof DEMO_COMMANDS[number]["id"];
export const SCOPES: readonly ShortcutMapScope[] = ["application", "window", "view", "global"];
const MENU_COMMANDS: readonly DemoCommandId[] = ["new-note", "open-recent", "find", "toggle-sidebar"];
// Examples a flow can trigger without key input: a plain rebind, one that collides with the
// Document menu's ⌘S, and a binding macOS reserves (rejected with E_BUSY).
export const EXAMPLES = {
  rebind: { id: "new-note", bindings: ["CmdOrCtrl+Shift+N"] },
  conflict: { id: "find", bindings: ["CmdOrCtrl+S"] },
  reserved: { id: "find", bindings: ["CmdOrCtrl+Tab"] },
} as const satisfies Record<string, { id: DemoCommandId; bindings: readonly string[] }>;
export type ExampleId = keyof typeof EXAMPLES;

type DemoState = { status: "loading" } | { status: "ready"; map: ShortcutMap<DemoCommandId> } | { status: "error"; error: string };
export type DemoFeedback = { fired?: { id: DemoCommandId; binding: string; scope: ShortcutMapScope }; result?: string };

class ShortcutMapDemo {
  private state: DemoState = { status: "loading" };
  private feedback: DemoFeedback = {};
  private readonly listeners = new Set<() => void>();
  private map?: ShortcutMap<DemoCommandId>;
  private menu?: Menu;
  private readonly registrations: AsyncRegistration[] = [];
  constructor(private readonly t: ShortcutMapMessages) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getState = () => this.state;
  readonly getFeedback = () => this.feedback;
  private set(next: Partial<{ state: DemoState; feedback: DemoFeedback }>) {
    if (next.state) this.state = next.state;
    if (next.feedback) this.feedback = next.feedback;
    for (const listener of this.listeners) listener();
  }
  private menuItems(shortcut: (id: DemoCommandId) => string | undefined): { items: MenuRootItem[] } {
    return { items: [{ type: "submenu", id: "shortcut-map", label: this.t.menuTitle, items: MENU_COMMANDS.map(id => ({ type: "action", id, label: this.t.commands[id], shortcut: shortcut(id) })) }] };
  }
  private fire(id: DemoCommandId, binding: string, scope: ShortcutMapScope) { this.set({ feedback: { ...this.feedback, fired: { id, binding, scope } } }); }
  async start() {
    try {
      const map = this.map = await createShortcutMap({ commands: DEMO_COMMANDS, key: "kitchen-sink-shortcut-map" });
      const handler = (event: { commandId: DemoCommandId; binding: string; scope: ShortcutMapScope }) => { this.fire(event.commandId, event.binding, event.scope); };
      const routed = (DEMO_COMMANDS as readonly ShortcutCommand<DemoCommandId>[]).filter(command => command.scope !== "global").map(command => command.id);
      // Each surface installs only where its platform layer exists; the availability list reports the rest.
      if (getShortcutMapAvailability("application").available) this.registrations.push(await map.register({ windowId: "main", handlers: Object.fromEntries(routed.map(id => [id, handler])) }));
      if (getShortcutMapAvailability("global").available) this.registrations.push(await map.register({ handlers: { "quick-capture": handler } }));
      if (getMenuAvailability().available) {
        const command = (id: DemoCommandId) => map.getSnapshot().commands.find(entry => entry.id === id)!;
        const primary = (id: DemoCommandId) => command(id).bindings[0];
        this.menu = await createMenu({ id: "ks-shortcut-map", ...this.menuItems(primary), onAction: ({ itemId }) => { const { id, bindings, scope } = command(itemId as DemoCommandId); this.fire(id, bindings[0] ?? "", scope); } });
        this.registrations.push(await map.attachMenu(this.menu, shortcut => this.menuItems(shortcut)));
      }
      this.set({ state: { status: "ready", map } });
    } catch (error) {
      this.set({ state: { status: "error", error: errorText(error) } });
      await this.close().catch(cleanup => { console.error("Shortcut map demo cleanup failed", cleanup); });
    }
  }
  async close() {
    for (const registration of this.registrations.splice(0)) await registration.remove();
    await this.menu?.remove(); this.menu = undefined;
    await this.map?.close(); this.map = undefined;
  }
  /** Rebinding results are API codes, so flows can assert them in any locale. */
  async run(change: (map: ShortcutMap<DemoCommandId>) => Promise<unknown>) {
    if (!this.map) return;
    try { await change(this.map); this.set({ feedback: { ...this.feedback, result: "ok" } }); }
    catch (error) { this.set({ feedback: { ...this.feedback, result: error instanceof Error && "code" in error ? `${error.name}:${String(error.code)}` : errorText(error) } }); }
  }
}

// One demo at a time: a remount (or Strict Mode) waits for the previous map's hotkeys and menu to be released.
let previous: Promise<unknown> = Promise.resolve();
const LOADING: DemoState = { status: "loading" }, NO_FEEDBACK: DemoFeedback = {};
const idle = { subscribe: () => () => {}, getState: () => LOADING, getFeedback: () => NO_FEEDBACK };
function useDemoLifetime(t: ShortcutMapMessages): ShortcutMapDemo | null {
  const [demo, setDemo] = useState<ShortcutMapDemo | null>(null);
  useEffect(() => {
    const current = new ShortcutMapDemo(t);
    let end!: () => void;
    const ended = new Promise<void>(resolve => { end = resolve; });
    previous = previous.then(() => current.start()).then(() => ended).then(() => current.close()).catch(error => { console.error("Shortcut map demo cleanup failed", error); });
    setDemo(current);
    return end;
  }, [t]);
  return demo;
}
export function useShortcutMapDemo(t: ShortcutMapMessages) {
  const demo = useDemoLifetime(t), source = demo ?? idle;
  const state = useSyncExternalStore(source.subscribe, source.getState);
  const feedback = useSyncExternalStore(source.subscribe, source.getFeedback);
  const run = (change: (map: ShortcutMap<DemoCommandId>) => Promise<unknown>) => demo?.run(change);
  return {
    state, feedback,
    example: (id: ExampleId) => run(map => map.rebind(EXAMPLES[id].id, EXAMPLES[id].bindings)),
    record: (id: DemoCommandId, binding: string) => run(map => map.rebind(id, [binding])),
    unbind: (id: DemoCommandId) => run(map => map.unbind(id)),
    reset: (id?: DemoCommandId) => run(map => map.reset(id)),
  };
}
