import { addKeyboardListener, createKeyboardConsumption, type KeyboardConsumption, type KeyboardConsumptionRule, type KeyboardEvent } from "@legendapp/spark-desktop-shortcuts/src/keyboard-manager";
import { SparkError, asyncRegistration, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { getDefaultHotkeyBindings, matchesParsedHotkey, parseBinding, normalizeHotkeyBindings, validateDefinitions, type HotkeyBindingState, type HotkeyDefinition } from "./bindings";
/** Where a hotkey registration or suspension applies: the whole application, or one window by its ID. */
export type HotkeyScope = { kind: "application" } | { kind: "window"; windowId: string };
/** What a routed hotkey handler receives: the matched binding, the keyboard event, the keys held now, and whether it is a key repeat. */
export type HotkeyHandlerContext = { binding: string; event: KeyboardEvent; pressedKeys: ReadonlySet<number>; repeated: boolean };
/** Handlers by command ID. A handler that returns `false` declines the key, which then goes to the next matching registration. */
export type RoutedHotkeyHandlers<Id extends string = string> = Partial<Record<Id, (context: HotkeyHandlerContext) => boolean | void>>;
/**
 * Options for `HotkeyRouter.register`. `bindings` overrides the definitions' defaults per command; `enabled` defaults to true;
 * `scope` defaults to the application. Higher `priority` wins (default 100 for a window scope, 0 otherwise); ties go to the later registration.
 */
export interface HotkeyRegistrationOptions<Id extends string = string> {
  bindings?: Partial<HotkeyBindingState<Id>>;
  definitions: readonly HotkeyDefinition<Id>[];
  enabled?: boolean;
  handlers: RoutedHotkeyHandlers<Id>;
  priority?: number;
  scope?: HotkeyScope;
}
/** A live `HotkeyRouter.register` registration; `remove()` releases it. Its methods reject with E_CLOSED once it has been removed. */
export interface HotkeyRegistration extends AsyncRegistration {
  setEnabled(enabled: boolean): Promise<void>;
  /** Replaces binding overrides. Each keydown fires either the old or the new binding, never both or neither. */
  setBindings(bindings: Partial<HotkeyBindingState>): Promise<void>;
}
/** Internal two-phase binding change, so several surfaces can switch at one JavaScript commit point. */
export interface StagedHotkeyBindings { commit(): void; settle(): Promise<void>; rollback(): Promise<void> }
const stagers = new WeakMap<HotkeyRegistration, (bindings: Partial<HotkeyBindingState>) => Promise<StagedHotkeyBindings>>();
/** Natively consumes the old and new bindings while JavaScript still dispatches the old ones. */
export function stageHotkeyBindings(registration: HotkeyRegistration, bindings: Partial<HotkeyBindingState>): Promise<StagedHotkeyBindings> {
  const stage = stagers.get(registration);
  if (!stage) return Promise.reject(new SparkError("E_INVALID_ARGUMENT", "Expected a command registration"));
  return stage(bindings);
}
/**
 * Routes key-down events to registered command handlers by scope and priority, and has the keyboard manager consume their bindings natively.
 * `suspend` stops routing in a scope until the returned registration is removed; `getPressedKeys` returns the key codes and modifier bits held now.
 */
export interface HotkeyRouter {
  register<Id extends string>(options: HotkeyRegistrationOptions<Id>): Promise<HotkeyRegistration>;
  suspend(scope?: HotkeyScope): Promise<AsyncRegistration>;
  setActiveWindowId(windowId: string | null): void;
  getPressedKeys(): ReadonlySet<number>;
}
export let capturing = false;
export function setCapturing(value: boolean) { capturing = value; }
function validateScope(scope: HotkeyScope) {
  if (!scope || (scope.kind !== "application" && scope.kind !== "window") || (scope.kind === "window" && (typeof scope.windowId !== "string" || !scope.windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Expected application or window scope");
}
/**
 * Creates a hotkey router. It listens to the keyboard manager only while it has registrations.
 * `register` rejects with E_INVALID_ARGUMENT for invalid options and E_UNSUPPORTED_OPTION for unknown ones.
 */
export function createHotkeyRouter(): HotkeyRouter {
  type Registration = Required<Pick<HotkeyRegistrationOptions, "definitions" | "handlers" | "scope" | "priority">> & { enabled: boolean; appliedEnabled: boolean; revision: number; bindings: Partial<HotkeyBindingState>; staged?: Partial<HotkeyBindingState>; order: number };
  const registrations = new Set<Registration>(), suspensions = new Set<HotkeyScope>(), pressed = new Set<number>();
  type Candidate = { registration: Registration; definition: HotkeyDefinition; handler: NonNullable<RoutedHotkeyHandlers[string]>; binding: string; parsed: ReturnType<typeof parseBinding> };
  let candidates = new Map<string, Candidate[]>();
  const modifierBits = [16, 17, 18, 19, 20, 23].map(bit => 1 << bit);
  const sorted = () => [...registrations].sort((a, b) => b.priority - a.priority || b.order - a.order);
  const bindingsFor = (bindings: Partial<HotkeyBindingState>, definition: HotkeyDefinition) => Object.hasOwn(bindings, definition.id) ? bindings[definition.id]! : definition.defaultBindings;
  const handlerFor = (registration: Registration, definition: HotkeyDefinition) => Object.hasOwn(registration.handlers, definition.id) ? registration.handlers[definition.id] : undefined;
  const rebuild = () => {
    const next = new Map<string, Candidate[]>();
    for (const registration of sorted()) {
      for (const definition of registration.definitions) {
        const handler = handlerFor(registration, definition);
        if (!handler) continue;
        for (const binding of bindingsFor(registration.bindings, definition)) {
          const parsed = parseBinding(binding), key = parsed.key.toLowerCase();
          const list = next.get(key) ?? [];
          list.push({ registration, definition, handler, binding, parsed }); next.set(key, list);
        }
      }
    }
    candidates = next;
  };
  let activeWindowId: string | null = null, order = 0, transitions = Promise.resolve();
  let consumption: KeyboardConsumption | undefined;
  let subscriptions: AsyncRegistration[] | undefined, cleanup: AsyncRegistration[] | undefined;
  const matchesScope = (scope: HotkeyScope, id: string | null) => scope.kind === "application" || scope.windowId === id;
  const updateModifiers = (event: KeyboardEvent) => {
    for (const modifier of modifierBits) { if (event.modifiers & modifier) pressed.add(modifier); else pressed.delete(modifier); }
  };
  const dispatch = (event: KeyboardEvent) => {
    const windowId = event.windowId;
    if (windowId !== activeWindowId) { pressed.clear(); activeWindowId = windowId; }
    const repeated = event.repeated; pressed.add(event.keyCode);
    updateModifiers(event);
    if (capturing || event.captured || !event.consumed) return false;
    for (const scope of suspensions) if (matchesScope(scope, windowId)) return false;
    for (const { registration, definition, handler, binding, parsed } of candidates.get(event.key.toLowerCase()) ?? []) {
      if (!registrations.has(registration) || !registration.enabled || !matchesScope(registration.scope, windowId)) continue;
      if (repeated && !definition.repeat) continue;
      if (matchesParsedHotkey(event, parsed, definition.allowExtraModifiers) && handler({ binding, event, pressedKeys: new Set(pressed), repeated }) !== false) return true;
    }
    return false;
  };
  const nativeRules = (): KeyboardConsumptionRule[] => {
    if ([...suspensions].some(scope => scope.kind === "application")) return [];
    const excludedWindowIds = [...suspensions].flatMap(scope => scope.kind === "window" ? [scope.windowId] : []);
    const rules: KeyboardConsumptionRule[] = [];
    // A staged change consumes both binding sets; dispatch still follows the committed set.
    for (const registration of sorted()) {
      if (!registration.enabled) continue;
      for (const definition of registration.definitions) {
        if (!handlerFor(registration, definition)) continue;
        const values = new Set([...bindingsFor(registration.bindings, definition), ...(registration.staged ? bindingsFor(registration.staged, definition) : [])]);
        for (const binding of values) rules.push({ ...parseBinding(binding), allowExtraModifiers: definition.allowExtraModifiers ?? false, repeat: definition.repeat ?? false,
          ...(registration.scope.kind === "window" ? { windowIds: [registration.scope.windowId] } : {}), excludedWindowIds });
      }
    }
    return rules;
  };
  const synchronize = () => {
    const operation = transitions.then(async () => {
      if (cleanup) { await Promise.all(cleanup.map(item => item.remove())); cleanup = undefined; }
      if (registrations.size) {
        if (!subscriptions) {
          const down = await addKeyboardListener("down", dispatch);
          try { subscriptions = [down, await addKeyboardListener("up", event => { pressed.delete(event.keyCode); updateModifiers(event); })]; }
          catch (error) { cleanup = [down]; try { await down.remove(); cleanup = undefined; } catch {} throw error; }
        }
        const enabledSnapshot = [...registrations].map(registration => [registration, registration.enabled] as const);
        if (consumption) await consumption.update(nativeRules());
        else consumption = await createKeyboardConsumption(nativeRules());
        for (const [registration, enabled] of enabledSnapshot) registration.appliedEnabled = enabled;
      } else if (subscriptions) {
        cleanup = [...(consumption ? [consumption] : []), ...subscriptions]; consumption = undefined; subscriptions = undefined; pressed.clear();
        await Promise.all(cleanup.map(item => item.remove())); cleanup = undefined;
      }
    });
    transitions = operation.catch(() => {}); return operation;
  };
  return {
    async register(options) {
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected command registration options");
      for (const key of Object.keys(options)) if (!["definitions", "bindings", "enabled", "handlers", "scope", "priority"].includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown command option: ${key}`);
      const { definitions, bindings = {}, enabled = true, handlers, scope = { kind: "application" }, priority = scope.kind === "window" ? 100 : 0 } = options;
      validateDefinitions(definitions); validateScope(scope);
      if (!Number.isFinite(priority) || typeof enabled !== "boolean" || !handlers || typeof handlers !== "object" || !bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid command registration options");
      const ids = new Set(definitions.map(definition => definition.id));
      for (const [id, handler] of Object.entries(handlers)) if (!ids.has(id as never) || typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Invalid handler for command ${id}`);
      const normalize = (value: Partial<HotkeyBindingState>) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected command bindings");
        for (const id of Object.keys(value)) if (!ids.has(id as never)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown command binding: ${id}`);
        return Object.fromEntries(Object.entries(value).map(([id, values]) => [id, normalizeHotkeyBindings(values as readonly string[])]));
      };
      const registration: Registration = { definitions: definitions.map(definition => ({ ...definition, defaultBindings: getDefaultHotkeyBindings(definition) })), bindings: normalize(bindings), enabled, appliedEnabled: enabled, revision: 0, handlers: { ...handlers }, scope: { ...scope }, priority, order: order++ };
      registrations.add(registration);
      rebuild();
      try { await synchronize(); } catch (error) {
        registrations.delete(registration); rebuild();
        try { await synchronize(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Command setup and cleanup failed"); }
        throw error;
      }
      const removal = asyncRegistration(() => { registrations.delete(registration); rebuild(); }, synchronize);
      const stage = async (value: Partial<HotkeyBindingState>): Promise<StagedHotkeyBindings> => {
        if (!registrations.has(registration)) throw new SparkError("E_CLOSED", "Command registration has been removed");
        const next = normalize(value);
        registration.staged = next;
        const unstage = () => { if (registration.staged === next) registration.staged = undefined; };
        try { await synchronize(); } catch (error) {
          unstage();
          try { await synchronize(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Command binding change and rollback failed"); }
          throw error;
        }
        let finished = false;
        return {
          commit() { if (finished) return; finished = true; if (registration.staged === next) { registration.bindings = next; registration.staged = undefined; rebuild(); } },
          settle: synchronize,
          async rollback() { if (!finished) { finished = true; unstage(); } await synchronize(); },
        };
      };
      let bindingChanges: Promise<unknown> = Promise.resolve();
      const handle: HotkeyRegistration = { remove: removal.remove, async setEnabled(value) {
        if (typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected enabled boolean");
        if (!registrations.has(registration)) throw new SparkError("E_CLOSED", "Command registration has been removed");
        const revision = ++registration.revision; registration.enabled = value;
        try { await synchronize(); } catch (error) { if (registration.revision === revision && registrations.has(registration)) registration.enabled = registration.appliedEnabled; throw error; }
      }, setBindings(value) {
        const change = bindingChanges.then(async () => { const staged = await stage(value); staged.commit(); await staged.settle(); });
        bindingChanges = change.catch(() => {}); return change;
      } };
      stagers.set(handle, stage);
      return handle;
    },
    async suspend(scope = { kind: "application" }) {
      validateScope(scope); const snapshot = { ...scope }; suspensions.add(snapshot);
      try { await synchronize(); } catch (error) {
        suspensions.delete(snapshot);
        try { await synchronize(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Command suspension and rollback failed"); }
        throw error;
      }
      return asyncRegistration(() => { suspensions.delete(snapshot); }, synchronize);
    },
    setActiveWindowId(id) { if (id !== null && (typeof id !== "string" || !id)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a window ID or null"); if (activeWindowId !== id) pressed.clear(); activeWindowId = id; },
    getPressedKeys: () => new Set(pressed),
  };
}
