import { addKeyboardListener, createKeyboardConsumption, type KeyboardConsumption, type KeyboardConsumptionRule, type KeyboardEvent } from "@legendapp/spark-desktop-shortcuts/src/keyboard-manager";
import { SparkError, asyncRegistration, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { getDefaultHotkeyBindings, matchesParsedHotkey, parseBinding, normalizeHotkeyBindings, validateDefinitions, type HotkeyBindingState, type HotkeyDefinition } from "./bindings";
export type HotkeyScope = { kind: "application" } | { kind: "window"; windowId: string };
export type HotkeyHandlerContext = { binding: string; event: KeyboardEvent; pressedKeys: ReadonlySet<number>; repeated: boolean };
export type RoutedHotkeyHandlers<Id extends string = string> = Partial<Record<Id, (context: HotkeyHandlerContext) => boolean | void>>;
export interface HotkeyRegistrationOptions<Id extends string = string> {
  bindings?: Partial<HotkeyBindingState<Id>>;
  definitions: readonly HotkeyDefinition<Id>[];
  enabled?: boolean;
  handlers: RoutedHotkeyHandlers<Id>;
  priority?: number;
  scope?: HotkeyScope;
}
export interface HotkeyRegistration extends AsyncRegistration { setEnabled(enabled: boolean): Promise<void> }
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
export function createHotkeyRouter(): HotkeyRouter {
  type Registration = Required<Pick<HotkeyRegistrationOptions, "definitions" | "handlers" | "scope" | "priority">> & { enabled: boolean; appliedEnabled: boolean; revision: number; bindings: Partial<HotkeyBindingState>; order: number };
  const registrations = new Set<Registration>(), suspensions = new Set<HotkeyScope>(), pressed = new Set<number>();
  type Candidate = { registration: Registration; definition: HotkeyDefinition; handler: NonNullable<RoutedHotkeyHandlers[string]>; binding: string; parsed: ReturnType<typeof parseBinding> };
  let candidates = new Map<string, Candidate[]>();
  const modifierBits = [16, 17, 18, 19, 20, 23].map(bit => 1 << bit);
  const rebuild = () => {
    const next = new Map<string, Candidate[]>();
    for (const registration of [...registrations].sort((a, b) => b.priority - a.priority || b.order - a.order)) {
      for (const definition of registration.definitions) {
        const handler = Object.hasOwn(registration.handlers, definition.id) ? registration.handlers[definition.id] : undefined;
        if (!handler) continue;
        for (const binding of Object.hasOwn(registration.bindings, definition.id) ? registration.bindings[definition.id]! : definition.defaultBindings) {
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
    for (const values of candidates.values()) for (const { registration, definition, parsed } of values) {
      if (!registration.enabled) continue;
      rules.push({ ...parsed, allowExtraModifiers: definition.allowExtraModifiers ?? false, repeat: definition.repeat ?? false,
        ...(registration.scope.kind === "window" ? { windowIds: [registration.scope.windowId] } : {}), excludedWindowIds });
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
      for (const id of Object.keys(bindings)) if (!ids.has(id as never)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown command binding: ${id}`);
      const registration: Registration = { definitions: definitions.map(definition => ({ ...definition, defaultBindings: getDefaultHotkeyBindings(definition) })), bindings: Object.fromEntries(Object.entries(bindings).map(([id, values]) => [id, normalizeHotkeyBindings(values as readonly string[])])), enabled, appliedEnabled: enabled, revision: 0, handlers: { ...handlers }, scope: { ...scope }, priority, order: order++ };
      registrations.add(registration);
      rebuild();
      try { await synchronize(); } catch (error) {
        registrations.delete(registration); rebuild();
        try { await synchronize(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Command setup and cleanup failed"); }
        throw error;
      }
      const removal = asyncRegistration(() => { registrations.delete(registration); rebuild(); }, synchronize);
      return { remove: removal.remove, async setEnabled(value) {
        if (typeof value !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Expected enabled boolean");
        if (!registrations.has(registration)) throw new SparkError("E_CLOSED", "Command registration has been removed");
        const revision = ++registration.revision; registration.enabled = value;
        try { await synchronize(); } catch (error) { if (registration.revision === revision && registrations.has(registration)) registration.enabled = registration.appliedEnabled; throw error; }
      } };
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
