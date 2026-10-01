import { addKeyboardListener, type KeyboardEvent } from "@legendapp/spark-desktop-shortcuts/src/keyboard-manager";
import { SparkError, asyncRegistration, type AsyncRegistration, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { getDefaultHotkeyBindings, matchesParsedHotkey, parseBinding, normalizeHotkeyBindings, validateDefinitions, type HotkeyBindingState, type HotkeyDefinition } from "./bindings";
export type HotkeyScope = { kind: "application" } | { kind: "window"; windowId: string };
export type HotkeyHandlerContext = { binding: string; event: KeyboardEvent; pressedKeys: ReadonlySet<number>; repeated: boolean };
export type RoutedHotkeyHandlers<Id extends string = string> = Partial<Record<Id, (context: HotkeyHandlerContext) => boolean | void>>;
export interface HotkeyRegistrationOptions<Id extends string = string> {
  bindings?: Partial<HotkeyBindingState<Id>>;
  definitions: readonly HotkeyDefinition<Id>[];
  enabled?: boolean | (() => boolean);
  handlers: RoutedHotkeyHandlers<Id>;
  priority?: number;
  scope?: HotkeyScope;
}
export interface HotkeyRouterOptions { getActiveWindowId?: () => string | null }
export interface HotkeyRouter {
  register<Id extends string>(options: HotkeyRegistrationOptions<Id>): Promise<AsyncRegistration>;
  suspend(scope?: HotkeyScope): Subscription;
  setActiveWindowId(windowId: string | null): void;
  getPressedKeys(): ReadonlySet<number>;
}
export let capturing = false;
export function setCapturing(value: boolean) { capturing = value; }
function validateScope(scope: HotkeyScope) {
  if (!scope || (scope.kind !== "application" && scope.kind !== "window") || (scope.kind === "window" && (typeof scope.windowId !== "string" || !scope.windowId))) throw new SparkError("E_INVALID_ARGUMENT", "Expected application or window scope");
}
export function createHotkeyRouter({ getActiveWindowId }: HotkeyRouterOptions = {}): HotkeyRouter {
  if (getActiveWindowId !== undefined && typeof getActiveWindowId !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected active window reader");
  type Registration = Required<Pick<HotkeyRegistrationOptions, "definitions" | "handlers" | "scope" | "priority">> & { enabled(): boolean; bindings: Partial<HotkeyBindingState>; order: number };
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
  let subscriptions: AsyncRegistration[] | undefined, cleanup: AsyncRegistration[] | undefined;
  const matchesScope = (scope: HotkeyScope, id: string | null) => scope.kind === "application" || scope.windowId === id;
  const updateModifiers = (event: KeyboardEvent) => {
    for (const modifier of modifierBits) { if (event.modifiers & modifier) pressed.add(modifier); else pressed.delete(modifier); }
  };
  const dispatch = (event: KeyboardEvent) => {
    const windowId = event.windowId ?? getActiveWindowId?.() ?? activeWindowId;
    if (windowId !== activeWindowId) { pressed.clear(); activeWindowId = windowId; }
    const repeated = pressed.has(event.keyCode); pressed.add(event.keyCode);
    updateModifiers(event);
    if (capturing) return false;
    for (const scope of suspensions) if (matchesScope(scope, windowId)) return false;
    let checked: Registration | undefined, enabled = false;
    for (const { registration, definition, handler, binding, parsed } of candidates.get(event.key.toLowerCase()) ?? []) {
      if (checked !== registration) { checked = registration; enabled = registration.enabled() && matchesScope(registration.scope, windowId); }
      if (!enabled) continue;
      if (repeated && !definition.repeat) continue;
      if (matchesParsedHotkey(event, parsed, definition.allowExtraModifiers) && handler({ binding, event, pressedKeys: new Set(pressed), repeated }) !== false) return true;
    }
    return false;
  };
  const synchronize = () => {
    const operation = transitions.then(async () => {
      if (cleanup) { await Promise.all(cleanup.map(item => item.remove())); cleanup = undefined; }
      if (registrations.size && !subscriptions) {
        const down = await addKeyboardListener("down", dispatch);
        try { subscriptions = [down, await addKeyboardListener("up", event => { pressed.delete(event.keyCode); updateModifiers(event); })]; }
        catch (error) { cleanup = [down]; try { await down.remove(); cleanup = undefined; } catch {} throw error; }
      } else if (!registrations.size && subscriptions) {
        cleanup = subscriptions; subscriptions = undefined; pressed.clear();
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
      if (!Number.isFinite(priority) || (typeof enabled !== "boolean" && typeof enabled !== "function") || !handlers || typeof handlers !== "object" || !bindings || typeof bindings !== "object" || Array.isArray(bindings)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid command registration options");
      const ids = new Set(definitions.map(definition => definition.id));
      for (const [id, handler] of Object.entries(handlers)) if (!ids.has(id as never) || typeof handler !== "function") throw new SparkError("E_INVALID_ARGUMENT", `Invalid handler for command ${id}`);
      for (const id of Object.keys(bindings)) if (!ids.has(id as never)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown command binding: ${id}`);
      const registration: Registration = { definitions: definitions.map(definition => ({ ...definition, defaultBindings: getDefaultHotkeyBindings(definition) })), bindings: Object.fromEntries(Object.entries(bindings).map(([id, values]) => [id, normalizeHotkeyBindings(values as readonly string[])])), enabled: typeof enabled === "function" ? enabled : () => enabled, handlers: { ...handlers }, scope: { ...scope }, priority, order: order++ };
      registrations.add(registration);
      rebuild();
      try { await synchronize(); } catch (error) { registrations.delete(registration); rebuild(); throw error; }
      return asyncRegistration(() => { registrations.delete(registration); rebuild(); }, synchronize);
    },
    suspend(scope = { kind: "application" }) {
      validateScope(scope); const snapshot = { ...scope }; suspensions.add(snapshot);
      return { remove() { suspensions.delete(snapshot); } };
    },
    setActiveWindowId(id) { if (id !== null && (typeof id !== "string" || !id)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a window ID or null"); if (activeWindowId !== id) pressed.clear(); activeWindowId = id; },
    getPressedKeys: () => new Set(pressed),
  };
}
