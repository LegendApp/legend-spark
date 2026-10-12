import { SparkError, asyncRegistration, type AsyncRegistration, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { formatAccelerator, parseAccelerator } from "@legendapp/spark-desktop-app/src/contracts/accelerator";
import { currentShortcutPlatform, getReservedShortcuts, type ReservedShortcut, type ShortcutPlatform } from "@legendapp/spark-desktop-app/src/contracts/reserved-shortcuts";
import { getShortcutInventory, getShortcutInventoryVersion, observeShortcutInventory, type ShortcutInventoryEntry } from "@legendapp/spark-desktop-app/src/contracts/shortcut-inventory";
import { getKeyboardAvailability } from "@legendapp/spark-desktop-shortcuts/src/keyboard-manager";
import { getGlobalShortcutAvailability, registerGlobalShortcut } from "@legendapp/spark-global-shortcuts";
import type { Menu, MenuUpdate } from "@legendapp/spark-native-menu/src/api";
import type { SettingsStore } from "@legendapp/spark-settings/src/store";
import { getDefaultHotkeyBindings, hotkeyBindingListsEqual, normalizeBinding, validateDefinitions, type HotkeyDefinition } from "./bindings";
import { createHotkeyRouter, stageHotkeyBindings, type HotkeyHandlerContext, type HotkeyRegistration, type HotkeyRouter, type StagedHotkeyBindings } from "./router";

/** Where a command is live. `view` commands outrank window commands, which outrank application commands. */
export type ShortcutMapScope = "application" | "window" | "view" | "global";
export type ShortcutCommand<Id extends string = string> = HotkeyDefinition<Id> & { scope?: ShortcutMapScope };
export { getReservedShortcuts, type ReservedShortcut, type ShortcutPlatform };
export type ShortcutConflictParty =
  | { source: "command"; scope: ShortcutMapScope; commandId: string }
  | { source: "shortcut"; scope: "application" }
  | { source: "shortcut"; scope: "window"; windowId: string }
  | { source: "global-shortcut"; scope: "global" }
  | { source: "menu"; scope: "menu"; menuId: string; itemId: string }
  | { source: "system"; scope: "system"; reserved: ReservedShortcut };
export interface ShortcutConflict<Id extends string = string> { commandId: Id; scope: ShortcutMapScope; binding: string; with: ShortcutConflictParty }
export interface ShortcutMapCommandState<Id extends string = string> {
  id: Id; title: string; description?: string; scope: ShortcutMapScope;
  bindings: readonly string[]; defaultBindings: readonly string[]; customized: boolean; conflicts: readonly ShortcutConflict<Id>[];
}
export interface ShortcutMapSnapshot<Id extends string = string> { commands: readonly ShortcutMapCommandState<Id>[]; conflicts: readonly ShortcutConflict<Id>[] }
export interface ShortcutMapChange<Id extends string = string> { reason: "rebind" | "unbind" | "reset" | "external"; commandIds: readonly Id[]; snapshot: ShortcutMapSnapshot<Id> }
export interface ShortcutCommandEvent<Id extends string = string> { commandId: Id; binding: string; scope: ShortcutMapScope; keyboard?: HotkeyHandlerContext }
export type ShortcutMapHandlers<Id extends string = string> = Partial<Record<Id, (event: ShortcutCommandEvent<Id>) => boolean | void>>;
export interface ShortcutMapRegisterOptions<Id extends string = string> { handlers: ShortcutMapHandlers<Id>; windowId?: string }
/** Receives each command's primary binding and returns the menu content to publish. */
export type ShortcutMapMenuBuilder<Id extends string = string> = (shortcut: (commandId: Id) => string | undefined) => MenuUpdate;
export interface ShortcutMapOptions<Id extends string = string> { commands: readonly ShortcutCommand<Id>[]; store?: SettingsStore; key?: string; router?: HotkeyRouter }
export const shortcutMapVersion = 2;
/** Persisted user changes only: a missing command uses its defaults, and an empty array unbinds it. */
export type ShortcutMapFile<Id extends string = string> = { version: typeof shortcutMapVersion; overrides: Partial<Record<Id, readonly string[]>> };
export interface ShortcutMap<Id extends string = string> {
  readonly router: HotkeyRouter;
  getSnapshot(): ShortcutMapSnapshot<Id>;
  /** Parses and checks a binding without applying it. Invalid accelerators reject E_INVALID_ARGUMENT, reserved ones E_BUSY. */
  validate(commandId: Id, binding: string): { binding: string; conflicts: readonly ShortcutConflict<Id>[] };
  rebind(commandId: Id, bindings: readonly string[]): Promise<ShortcutMapChange<Id>>;
  unbind(commandId: Id): Promise<ShortcutMapChange<Id>>;
  reset(commandId?: Id): Promise<ShortcutMapChange<Id>>;
  register(options: ShortcutMapRegisterOptions<Id>): Promise<AsyncRegistration>;
  attachMenu(menu: Menu, build: ShortcutMapMenuBuilder<Id>): Promise<AsyncRegistration>;
  addListener(listener: (change: ShortcutMapChange<Id>) => void): Subscription;
  close(): Promise<void>;
}

const lenient = { allowUnmodifiedCharacter: true, allowExtendedKeys: true };
/** The platform-resolved spelling two bindings share when they press the same keys. */
const keyOf = (binding: string, platform = currentShortcutPlatform()) => formatAccelerator(parseAccelerator(binding, platform, lenient));
const SCOPES: readonly ShortcutMapScope[] = ["application", "window", "view", "global"];

/** Live dispatch needs the keyboard manager for application/window/view commands and global hotkeys for global ones. */
export function getShortcutMapAvailability(scope: ShortcutMapScope): Availability {
  if (!SCOPES.includes(scope)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown shortcut map scope");
  return scope === "global" ? getGlobalShortcutAvailability() : getKeyboardAvailability();
}

export async function createShortcutMap<Id extends string>(options: ShortcutMapOptions<Id>): Promise<ShortcutMap<Id>> {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected shortcut map options");
  for (const name of Object.keys(options)) if (!["commands", "store", "key", "router"].includes(name)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown shortcut map option: ${name}`);
  const { key = "shortcut-map", router = createHotkeyRouter() } = options;
  if (typeof key !== "string" || !key) throw new SparkError("E_INVALID_ARGUMENT", "Expected a settings key");
  validateDefinitions(options.commands);
  const platform = currentShortcutPlatform();
  const reserved = new Map(getReservedShortcuts(platform).map(entry => [keyOf(entry.accelerator, platform), entry]));
  const commands = new Map<Id, ShortcutMapCommandState<Id>>();
  /** Canonical spelling (CmdOrCtrl kept, so stored bindings stay portable); rejects reserved bindings. */
  const check = (id: Id, binding: string) => {
    const command = commands.get(id);
    if (!command) throw new SparkError("E_NOT_FOUND", `Unknown command: ${String(id)}`);
    // Global hotkeys use the strict surface parser: a modifier is required and extended keys are unavailable.
    if (command.scope === "global") parseAccelerator(binding, platform);
    const canonical = normalizeBinding(binding), hit = reserved.get(keyOf(canonical));
    if (hit?.severity === "reserved") throw new SparkError("E_BUSY", `${canonical} is reserved: ${hit.description}`);
    return canonical;
  };
  const checkList = (id: Id, values: readonly string[]) => {
    if (!Array.isArray(values)) throw new SparkError("E_INVALID_ARGUMENT", "Bindings must be an array of accelerators");
    return [...new Set(values.map(value => check(id, value)))];
  };
  for (const definition of options.commands) {
    const scope = definition.scope ?? "application";
    if (!SCOPES.includes(scope)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown scope for command ${definition.id}`);
    commands.set(definition.id, { id: definition.id, title: definition.title, ...(definition.description ? { description: definition.description } : {}), scope, bindings: [], defaultBindings: getDefaultHotkeyBindings(definition), customized: false, conflicts: [] });
  }
  const definitions = new Map(options.commands.map(definition => [definition.id, { id: definition.id, title: definition.title, defaultBindings: commands.get(definition.id)!.defaultBindings, ...(definition.repeat !== undefined ? { repeat: definition.repeat } : {}), ...(definition.allowExtraModifiers !== undefined ? { allowExtraModifiers: definition.allowExtraModifiers } : {}) }]));
  for (const command of commands.values()) checkList(command.id, command.defaultBindings);
  const store = options.store ?? (await import("@legendapp/spark-settings")).settings;

  // Load, migrating version 1 (createHotkeyStore's full binding lists) to override-only version 2.
  let overrides = new Map<Id, readonly string[]>();
  const stored = await store.get(key);
  const decode = (entries: Record<string, unknown>, keepDefaults: boolean) => {
    const result = new Map<Id, readonly string[]>();
    for (const [id, values] of Object.entries(entries)) {
      if (!commands.has(id as Id)) continue; // Commands removed by an app update drop their overrides.
      let normalized: string[];
      try { normalized = checkList(id as Id, values as readonly string[]); }
      catch (cause) { throw new SparkError("E_INVALID_DATA", `Stored bindings for ${id} are invalid`, { cause }); }
      if (keepDefaults || !hotkeyBindingListsEqual(normalized, commands.get(id as Id)!.defaultBindings)) result.set(id as Id, normalized);
    }
    return result;
  };
  const record = (value: unknown, field: string) => {
    const entries = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[field] : undefined;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new SparkError("E_INVALID_DATA", `Expected a ${field} object`);
    return entries as Record<string, unknown>;
  };
  const serialize = (value: ReadonlyMap<Id, readonly string[]>) => ({ version: shortcutMapVersion, overrides: Object.fromEntries([...value].map(([id, values]) => [id, [...values]])) });
  if (stored !== undefined) {
    const version = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as { version?: unknown }).version : undefined;
    if (version === shortcutMapVersion) overrides = decode(record(stored, "overrides"), true);
    else if (version === 1) { overrides = decode(record(stored, "bindings"), false); await store.set(key, serialize(overrides)); }
    else throw new SparkError("E_INVALID_DATA", `Unsupported shortcut map version: ${String(version)}`);
  }

  type Owner = { tiers: { registration: HotkeyRegistration; ids: Id[] }[]; globals: Map<Id, Map<string, AsyncRegistration>>; handlers: ShortcutMapHandlers<Id>; active: boolean };
  const owners = new Set<Owner>(), menus = new Map<object, { menu: Menu; build: ShortcutMapMenuBuilder<Id> }>(), ownGlobals = new Set<object>();
  const listeners = new Set<(change: ShortcutMapChange<Id>) => void>();
  let closed = false, busy = false, revision = 0, queue: Promise<unknown> = Promise.resolve(), stopObserving: (() => void) | undefined;
  let cache: { revision: number; inventory: number; snapshot: ShortcutMapSnapshot<Id> } | undefined, emittedConflicts = "";
  const bindingsOf = (id: Id, source: ReadonlyMap<Id, readonly string[]> = overrides) => source.get(id) ?? commands.get(id)!.defaultBindings;
  /** One operation at a time: staging, persistence and registration changes never interleave. */
  const serial = <T>(operation: () => T | Promise<T>): Promise<T> => {
    // Conflicts an operation changed without emitting (menus, registrations) are announced when it ends.
    const run = queue.then(async () => { busy = true; try { return await operation(); } finally { busy = false; observe(); } });
    queue = run.catch(() => {}); return run;
  };
  const enqueue = <T>(operation: () => T | Promise<T>): Promise<T> => serial(() => {
    if (closed) throw new SparkError("E_CLOSED", "Shortcut map is closed");
    return operation();
  });

  const party = ({ owner }: ShortcutInventoryEntry): ShortcutConflictParty =>
    owner.source === "menu" ? { source: "menu", scope: "menu", menuId: owner.menuId, itemId: owner.itemId }
    : owner.source === "global-shortcut" ? { source: "global-shortcut", scope: "global" }
    : owner.windowId ? { source: "shortcut", scope: "window", windowId: owner.windowId } : { source: "shortcut", scope: "application" };
  /** Conflicts for `bindings` of `id` against other commands, live registrations outside this map, and OS warnings. */
  const conflictsFor = (id: Id, bindings: readonly string[]): ShortcutConflict<Id>[] => {
    const scope = commands.get(id)!.scope, result: ShortcutConflict<Id>[] = [];
    // Menu items in attached menus whose ID is a command ID are that command's own key equivalents.
    const attached = new Set([...menus.values()].map(({ menu }) => menu.id));
    const external = getShortcutInventory(ownGlobals).filter(entry => !(entry.owner.source === "menu" && attached.has(entry.owner.menuId) && commands.has(entry.owner.itemId as Id)));
    for (const binding of bindings) {
      const pressed = keyOf(binding);
      for (const other of commands.values()) if (other.id !== id && bindingsOf(other.id).some(value => keyOf(value) === pressed)) result.push({ commandId: id, scope, binding, with: { source: "command", scope: other.scope, commandId: other.id } });
      for (const entry of external) if (formatAccelerator(entry.accelerator) === pressed) result.push({ commandId: id, scope, binding, with: party(entry) });
      const warning = reserved.get(pressed);
      if (warning) result.push({ commandId: id, scope, binding, with: { source: "system", scope: "system", reserved: warning } });
    }
    return result;
  };
  const getSnapshot = (): ShortcutMapSnapshot<Id> => {
    const inventory = getShortcutInventoryVersion();
    if (cache?.revision === revision && cache.inventory === inventory) return cache.snapshot;
    const states = [...commands.values()].map(command => {
      const bindings = bindingsOf(command.id);
      return { ...command, bindings, customized: overrides.has(command.id), conflicts: conflictsFor(command.id, bindings) };
    });
    let snapshot: ShortcutMapSnapshot<Id> = { commands: states, conflicts: states.flatMap(state => state.conflicts) };
    // Unrelated registration changes keep the previous object, so subscribed views do not rerender.
    if (cache && JSON.stringify(cache.snapshot) === JSON.stringify(snapshot)) snapshot = cache.snapshot;
    cache = { revision, inventory, snapshot }; return snapshot;
  };
  const emit = (reason: ShortcutMapChange<Id>["reason"], commandIds: readonly Id[]) => {
    const snapshot = getSnapshot(); emittedConflicts = JSON.stringify(snapshot.conflicts);
    for (const listener of [...listeners]) {
      try { listener({ reason, commandIds, snapshot }); } catch (cause) { console.error(new SparkError("E_NATIVE", "Shortcut map listener failed", { cause })); }
    }
    return { reason, commandIds, snapshot };
  };
  function observe() {
    // Operations emit their own change; registrations elsewhere only notify when conflicts change.
    if (!busy && listeners.size && JSON.stringify(getSnapshot().conflicts) !== emittedConflicts) emit("external", []);
  }

  const shortcutLookup = (source: ReadonlyMap<Id, readonly string[]>) => (id: Id) => commands.has(id) ? bindingsOf(id, source)[0] : undefined;
  const globalHandler = (owner: Owner, id: Id, binding: string) => () => {
    // The gate makes the JavaScript commit the switch point while old and new hotkeys overlap.
    if (!owner.active || !bindingsOf(id).includes(binding)) return;
    const handler = owner.handlers[id];
    if (handler) handler({ commandId: id, binding, scope: "global" });
  };
  const addGlobal = async (owner: Owner, id: Id, binding: string) => {
    const registration = await registerGlobalShortcut(binding, globalHandler(owner, id, binding));
    ownGlobals.add(registration);
    let bindings = owner.globals.get(id);
    if (!bindings) owner.globals.set(id, bindings = new Map());
    bindings.set(binding, registration);
  };
  const removeGlobal = async (owner: Owner, id: Id, binding: string) => {
    const registration = owner.globals.get(id)?.get(binding);
    if (!registration) return;
    await registration.remove();
    owner.globals.get(id)!.delete(binding); ownGlobals.delete(registration);
  };
  const tierBindings = (ids: readonly Id[], source: ReadonlyMap<Id, readonly string[]>) => Object.fromEntries(ids.map(id => [id, bindingsOf(id, source)])) as Partial<Record<Id, readonly string[]>>;
  const releaseOwner = async (owner: Owner) => {
    const failures: unknown[] = [];
    for (const { registration } of owner.tiers) await registration.remove().catch(error => { failures.push(error); });
    for (const [id, bindings] of owner.globals) for (const binding of [...bindings.keys()]) await removeGlobal(owner, id, binding).catch(error => { failures.push(error); });
    if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures, "Shortcut map registration cleanup failed");
  };

  /** Stage every surface, persist, switch at one synchronous commit, then release the old bindings. */
  const apply = async (next: Map<Id, readonly string[]>, changed: readonly Id[], reason: ShortcutMapChange<Id>["reason"]) => {
    const staged: StagedHotkeyBindings[] = [], added: [Owner, Id, string][] = [], updated: { menu: Menu; build: ShortcutMapMenuBuilder<Id> }[] = [];
    try {
      for (const owner of owners) for (const tier of owner.tiers) staged.push(await stageHotkeyBindings(tier.registration, tierBindings(tier.ids, next)));
      for (const owner of owners) for (const id of owner.globals.keys()) for (const binding of bindingsOf(id, next)) {
        if (!owner.globals.get(id)!.has(binding)) { await addGlobal(owner, id, binding); added.push([owner, id, binding]); }
      }
      // Both binding sets are consumed natively here, so key equivalents cannot fire from either menu state.
      for (const entry of menus.values()) { updated.push(entry); await entry.menu.update(entry.build(shortcutLookup(next))); }
      await store.set(key, serialize(next));
    } catch (error) {
      const failures: unknown[] = [];
      for (const entry of updated) await entry.menu.update(entry.build(shortcutLookup(overrides))).catch(cause => { failures.push(cause); });
      for (const [owner, id, binding] of added) await removeGlobal(owner, id, binding).catch(cause => { failures.push(cause); });
      for (const stage of staged) await stage.rollback().catch(cause => { failures.push(cause); });
      if (failures.length) throw new AggregateError([error, ...failures], "Shortcut map change and rollback failed");
      throw error;
    }
    overrides = next; revision++;
    for (const stage of staged) stage.commit();
    const failures: unknown[] = [];
    for (const stage of staged) await stage.settle().catch(cause => { failures.push(cause); });
    for (const owner of owners) for (const [id, bindings] of owner.globals) for (const binding of [...bindings.keys()]) {
      if (!bindingsOf(id).includes(binding)) await removeGlobal(owner, id, binding).catch(cause => { failures.push(cause); });
    }
    const change = emit(reason, changed);
    // The new bindings are live and saved; only releasing the old native bindings failed.
    if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures, "Shortcut map released old bindings incompletely");
    return change;
  };
  const rebind = (id: Id, values: readonly string[], reason: "rebind" | "unbind") => enqueue(() => {
    const bindings = checkList(id, values), next = new Map(overrides);
    if (hotkeyBindingListsEqual(bindings, commands.get(id)!.defaultBindings)) next.delete(id); else next.set(id, bindings);
    return apply(next, [id], reason);
  });

  const map: ShortcutMap<Id> = {
    router,
    getSnapshot,
    validate(id, binding) { const canonical = check(id, binding); return { binding: canonical, conflicts: conflictsFor(id, [canonical]) }; },
    rebind: (id, bindings) => rebind(id, bindings, "rebind"),
    unbind: id => rebind(id, [], "unbind"),
    reset(id) {
      return enqueue(() => {
        if (id !== undefined && !commands.has(id)) throw new SparkError("E_NOT_FOUND", `Unknown command: ${String(id)}`);
        const next = new Map(overrides);
        if (id === undefined) next.clear(); else next.delete(id);
        return apply(next, id === undefined ? [...overrides.keys()] : [id], "reset");
      });
    },
    register(registerOptions) {
      return enqueue(async () => {
        if (!registerOptions || typeof registerOptions !== "object" || Array.isArray(registerOptions)) throw new SparkError("E_INVALID_ARGUMENT", "Expected shortcut map registration options");
        for (const name of Object.keys(registerOptions)) if (!["handlers", "windowId"].includes(name)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown registration option: ${name}`);
        const { handlers, windowId } = registerOptions;
        if (!handlers || typeof handlers !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Expected command handlers");
        const ids = Object.keys(handlers) as Id[];
        for (const id of ids) if (!commands.has(id) || typeof handlers[id] !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Invalid handler for command ${id}`);
        if (windowId !== undefined && (typeof windowId !== "string" || !windowId)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a window ID");
        const byScope = (scope: ShortcutMapScope) => ids.filter(id => commands.get(id)!.scope === scope);
        if (!windowId && (byScope("window").length || byScope("view").length)) throw new SparkError("E_INVALID_ARGUMENT", "Window and view commands need a windowId");
        const owner: Owner = { tiers: [], globals: new Map(), handlers: { ...handlers }, active: true };
        try {
          for (const [scope, priority] of [["application", 0], ["window", 100], ["view", 200]] as const) {
            const tierIds = byScope(scope);
            if (!tierIds.length) continue;
            const routed = Object.fromEntries(tierIds.map(id => [id, (keyboard: HotkeyHandlerContext) => owner.active ? owner.handlers[id]!({ commandId: id, binding: keyboard.binding, scope, keyboard }) : false])) as Partial<Record<Id, (keyboard: HotkeyHandlerContext) => boolean | void>>;
            const registration = await router.register({ definitions: tierIds.map(id => definitions.get(id)!), bindings: tierBindings(tierIds, overrides), handlers: routed, priority, scope: scope === "application" ? { kind: "application" } : { kind: "window", windowId: windowId! } });
            owner.tiers.push({ registration, ids: tierIds });
          }
          for (const id of byScope("global")) { owner.globals.set(id, new Map()); for (const binding of bindingsOf(id)) await addGlobal(owner, id, binding); }
        } catch (error) {
          owner.active = false;
          try { await releaseOwner(owner); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Shortcut map registration and cleanup failed"); }
          throw error;
        }
        owners.add(owner); revision++;
        return asyncRegistration(() => { owner.active = false; }, () => serial(async () => { owners.delete(owner); revision++; await releaseOwner(owner); }));
      });
    },
    attachMenu(menu, build) {
      return enqueue(async () => {
        if (!menu || typeof menu.update !== "function" || typeof build !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a menu and a builder");
        await menu.update(build(shortcutLookup(overrides)));
        const token = {};
        menus.set(token, { menu, build }); revision++;
        return asyncRegistration(() => { menus.delete(token); revision++; observe(); }, async () => {});
      });
    },
    addListener(listener) {
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a listener");
      const entry = (change: ShortcutMapChange<Id>) => listener(change);
      listeners.add(entry);
      if (!stopObserving) { emittedConflicts = JSON.stringify(getSnapshot().conflicts); stopObserving = observeShortcutInventory(observe); }
      return { remove() { listeners.delete(entry); if (!listeners.size && stopObserving) { stopObserving(); stopObserving = undefined; } } };
    },
    close() {
      return enqueue(async () => {
        closed = true; stopObserving?.(); stopObserving = undefined; listeners.clear(); menus.clear();
        const failures: unknown[] = [];
        for (const owner of owners) { owner.active = false; await releaseOwner(owner).catch(error => { failures.push(error); }); }
        owners.clear();
        if (failures.length) throw failures.length === 1 ? failures[0] : new AggregateError(failures, "Shortcut map cleanup failed");
      });
    },
  };
  return map;
}
