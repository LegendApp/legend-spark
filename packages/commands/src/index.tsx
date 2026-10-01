import { addKeyboardListener, createKeyboardConsumption, type KeyboardEvent } from "@legendapp/spark-desktop-shortcuts/src/keyboard-manager";
import { SparkError, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { cn } from "@legendapp/spark-ui/src/classnames";
import { observable } from "@legendapp/state";
import { useValue } from "@legendapp/state/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { bindingFromEvent, bindingKey, formatHotkey, getDefaultHotkeyBindings, getHotkeyBindingConflicts, hotkeyBindingListsEqual, limitHotkeyBindings, normalizeHotkeyBindings, type HotkeyValue, type HotkeyDefinition, type HotkeyBindingState } from "./bindings";
import { setCapturing, type HotkeyRegistration, type HotkeyRegistrationOptions, type HotkeyRouter, type HotkeyScope } from "./router";
export { createHotkeyRouter } from "./router";
export type { HotkeyRouter, HotkeyRegistration, HotkeyScope, HotkeyRegistrationOptions, HotkeyHandlerContext, RoutedHotkeyHandlers } from "./router";
export { hotkeyFileVersion, normalizeHotkeyFile, serializeHotkeyFile, normalizeHotkeyBindings, formatHotkey, matchesHotkey, getDefaultHotkeyBindings, getHotkeyBindingConflicts, hotkeyBindingListsEqual } from "./bindings";
export type { HotkeyValue, HotkeyDefinition, HotkeyBindingState, HotkeyFile, HotkeyBindingLimitOptions, HotkeyMatchOptions } from "./bindings";
export { createHotkeyStore, type HotkeyStoreOptions } from "./storage";

export type HotkeyRegistrationState = { status: "loading" } | { status: "ready"; registration: HotkeyRegistration } | { status: "error"; error: Error; registration?: HotkeyRegistration };
export type UseRoutedHotkeysOptions<Id extends string> = HotkeyRegistrationOptions<Id> & { router: HotkeyRouter; onError?: (error: Error) => void; onCleanupError?: (error: unknown, registration: AsyncRegistration) => void };
export function useRoutedHotkeys<Id extends string>(options: UseRoutedHotkeysOptions<Id>): HotkeyRegistrationState {
  const current = useRef(options); useLayoutEffect(() => { current.current = options; });
  const [state, setState] = useState<HotkeyRegistrationState>({ status: "loading" });
  const owner = useRef<HotkeyRegistration | undefined>(undefined), transition = useRef<Promise<unknown>>(Promise.resolve()), retry = useRef<HotkeyRegistration | undefined>(undefined);
  const { router, definitions, bindings, priority, scope, enabled = true } = options;
  const handlerIds = JSON.stringify(definitions.filter(definition => Object.hasOwn(options.handlers, definition.id)).map(definition => definition.id));
  useEffect(() => {
    let active = true, registration: HotkeyRegistration | undefined;
    const report = (cause: unknown) => {
      if (!active) return;
      const error = cause instanceof Error ? cause : new SparkError("E_NATIVE", "Command registration failed", { cause });
      setState({ status: "error", error, registration }); current.current.onError?.(error);
    };
    const dispose = async (handle: HotkeyRegistration) => {
      try { await handle.remove(); if (retry.current === handle) retry.current = undefined; }
      catch (error) { retry.current = handle; if (current.current.onCleanupError) current.current.onCleanupError(error, handle); else console.error(error); throw error; }
    };
    setState({ status: "loading" });
    const handlers = Object.fromEntries(definitions.filter(definition => Object.hasOwn(options.handlers, definition.id)).map(definition => [definition.id, (context: Parameters<NonNullable<typeof options.handlers[Id]>>[0]) => {
      if (!active) return false;
      const handler = Object.hasOwn(current.current.handlers, definition.id) ? current.current.handlers[definition.id] : undefined; return handler ? handler(context) : false;
    }])) as typeof options.handlers;
    const setup = transition.current.catch(() => {}).then(async () => {
      if (retry.current) await dispose(retry.current);
      if (!active) return;
      const handle = await router.register({ definitions, bindings, priority, scope, handlers, enabled });
      registration = handle;
      if (!active) { await dispose(handle); return; }
      owner.current = handle;
      if ((current.current.enabled ?? true) !== enabled) await handle.setEnabled(current.current.enabled ?? true);
      if (active) setState({ status: "ready", registration: handle });
    }).catch(report);
    transition.current = setup;
    return () => {
      active = false; if (owner.current === registration) owner.current = undefined;
      if (registration) transition.current = setup.then(() => dispose(registration!)).catch(() => {});
    };
  }, [router, definitions, bindings, priority, handlerIds, scope?.kind, scope?.kind === "window" ? scope.windowId : undefined]);
  useEffect(() => {
    const handle = owner.current;
    if (handle) void handle.setEnabled(enabled).then(() => {
      if (owner.current === handle) setState(previous => previous.status === "ready" && previous.registration === handle ? previous : { status: "ready", registration: handle });
    }, cause => {
      if (owner.current !== handle) return;
      const error = cause instanceof Error ? cause : new SparkError("E_NATIVE", "Command enablement failed", { cause });
      setState({ status: "error", error, registration: handle }); current.current.onError?.(error);
    });
  }, [enabled]);
  return state;
}
export interface HotkeySuspensionOptions {
  active: boolean; router: HotkeyRouter; scope?: HotkeyScope;
  onError?: (error: unknown) => void; onCleanupError?: (error: unknown, registration: AsyncRegistration) => void;
}
export function useHotkeySuspension(options: HotkeySuspensionOptions): void {
  const current = useRef(options); useLayoutEffect(() => { current.current = options; });
  const { active, router, scope } = options;
  useEffect(() => {
    if (!active) return;
    let mounted = true, registration: AsyncRegistration | undefined;
    const dispose = (handle: AsyncRegistration) => { void handle.remove().catch(error => { if (current.current.onCleanupError) current.current.onCleanupError(error, handle); else console.error(error); }); };
    void router.suspend(scope).then(handle => { registration = handle; if (!mounted) dispose(handle); }, error => {
      if (mounted) { if (current.current.onError) current.current.onError(error); else console.error(error); }
    });
    return () => { mounted = false; if (registration) dispose(registration); };
  }, [active, router, scope?.kind, scope?.kind === "window" ? scope.windowId : undefined]);
}
export interface HotkeyCaptureProps {
  className?: string;
  disabled?: boolean;
  onCaptureChange?: (capturing: boolean) => void;
  onChange(value: HotkeyValue | null): void;
  onError?: (error: unknown) => void;
  onCleanupError?: (error: unknown, registration: AsyncRegistration) => void;
  placeholder?: string;
  value: HotkeyValue | null;
}
const activeCapture$ = observable<symbol | null>(null);
export function HotkeyCapture(props: HotkeyCaptureProps) {
  const { className, disabled = false, placeholder = "Click to record", value } = props;
  const current = useRef(props); useLayoutEffect(() => { current.current = props; });
  const [id] = useState(() => Symbol("HotkeyCapture"));
  const isCapturing = useValue(() => activeCapture$.get() === id);
  const [display, setDisplay] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const captured = useRef<{ code: number; value: string } | null>(null), started = useRef(0), lastCapturing = useRef(false);
  const notifyCapture = (active: boolean) => { if (lastCapturing.current !== active) { lastCapturing.current = active; current.current.onCaptureChange?.(active); } };
  const cancel = () => { if (activeCapture$.peek() === id) { activeCapture$.set(null); setCapturing(false); } };
  const start = () => { if (!disabled) { captured.current = null; setDisplay(null); setError(null); started.current = Date.now(); activeCapture$.set(id); setCapturing(true); } };
  useEffect(() => {
    notifyCapture(isCapturing);
    if (!isCapturing) return;
    let active = true;
    const handles: AsyncRegistration[] = [];
    const dispose = (handle: AsyncRegistration) => { void handle.remove().catch(error => { if (current.current.onCleanupError) current.current.onCleanupError(error, handle); else console.error(error); }); };
    const listener = (type: "down" | "up") => (event: KeyboardEvent) => {
      if (!active || activeCapture$.peek() !== id || !event.captured) return;
      if (event.key === "\u001b") { cancel(); return; }
      if (type === "down") {
        const binding = bindingFromEvent(event);
        if (binding) { captured.current = { code: event.keyCode, value: binding }; setDisplay(formatHotkey(binding)); }
      } else if (captured.current?.code === event.keyCode) { try { current.current.onChange(captured.current.value); } finally { cancel(); } }
    };
    const accepted = (handle: AsyncRegistration) => { if (active) handles.push(handle); else dispose(handle); };
    const failed = (error: unknown) => { if (active) { setError(error instanceof Error ? error.message : "Keyboard capture unavailable"); current.current.onError?.(error); cancel(); } };
    for (const type of ["down", "up"] as const) void addKeyboardListener(type, listener(type)).then(accepted, failed);
    void createKeyboardConsumption([], true).then(accepted, failed);
    return () => { active = false; for (const handle of handles) dispose(handle); };
  }, [isCapturing, id]);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  useEffect(() => () => { cancel(); notifyCapture(false); }, [id]);
  return <Pressable accessibilityRole="button" className={cn("min-h-8 min-w-44 justify-center rounded-md border border-border-primary bg-background-primary px-3 py-1.5", isCapturing && "border-accent-primary", disabled && "opacity-60", className)} disabled={disabled} focusable onBlur={() => { if (isCapturing && Date.now() - started.current > 100) cancel(); }} onPressIn={start} onPress={() => { if (!isCapturing) start(); }}>
    <View className="flex-row items-center"><Text className={cn("text-sm text-text-primary", !value && !isCapturing && "text-text-tertiary")}>{error ?? (isCapturing ? display || "Press keys..." : formatHotkey(value, placeholder))}</Text></View>
  </Pressable>;
}
export interface HotkeyBindingsSettingsPageProps<Id extends string> {
  definitions: readonly HotkeyDefinition<Id>[];
  maxBindingsPerCommand?: number;
  onCaptureChange?: (capturing: boolean) => void;
  onChange(id: Id, values: readonly HotkeyValue[]): void;
  onResetAll?: () => void;
  renderFooter?: () => ReactNode;
  showTitle?: boolean;
  values: HotkeyBindingState<Id>;
}
function SFSymbol(props: { name: string; size: number }) {
  const Component = (require("@legendapp/spark-ui/src/sf-symbol") as typeof import("@legendapp/spark-ui/src/sf-symbol")).SFSymbol;
  return <Component {...props} />;
}
export function HotkeyBindingsSettingsContent<HotkeyId extends string>({
  definitions,
  maxBindingsPerCommand,
  onCaptureChange,
  onChange,
  onResetAll,
  renderFooter,
  showTitle = true,
  values,
}: HotkeyBindingsSettingsPageProps<HotkeyId>) {
  const [addingBindingForId, setAddingBindingForId] = useState<HotkeyId | null>(null);
  const conflicts = getHotkeyBindingConflicts(definitions, values);
  const titles = new Map(definitions.map((definition) => [definition.id, definition.title]));
  const hasCustomBindings = definitions.some((definition) => {
    const bindings = limitHotkeyBindings(values[definition.id] ?? [], maxBindingsPerCommand);
    const defaultBindings = limitHotkeyBindings(getDefaultHotkeyBindings(definition), maxBindingsPerCommand);
    return !hotkeyBindingListsEqual(bindings, defaultBindings);
  });
  const usesSingleBinding = maxBindingsPerCommand === 1;

  const resetAll = () => {
    setAddingBindingForId(null);
    if (onResetAll) {
      onResetAll();
    } else {
      for (const definition of definitions) {
        onChange(definition.id, getDefaultHotkeyBindings(definition));
      }
    }
  };

  return (
    <>
      <View className="flex-col gap-6">
        <View className={cn("flex-row items-center gap-4", showTitle ? "justify-between" : "justify-end")}>
          {showTitle ? (
            <Text className="text-xl font-semibold text-text-primary leading-tight">Hotkeys</Text>
          ) : null}
            <Pressable
              accessibilityRole="button"
              className={cn(
                "rounded-md border border-border-primary bg-background-primary px-3 py-1.5",
                !hasCustomBindings && "opacity-50",
              )}
              disabled={!hasCustomBindings}
              onPress={resetAll}
            >
              <Text className="text-sm text-text-primary">Reset All</Text>
            </Pressable>
        </View>
        <View className="overflow-hidden rounded-xl border border-border-primary bg-background-secondary/20">
          {definitions.map((definition, definitionIndex) => {
            const bindings = limitHotkeyBindings(
              values[definition.id] ?? getDefaultHotkeyBindings(definition),
              maxBindingsPerCommand,
            );
            const defaultBindings = limitHotkeyBindings(
              getDefaultHotkeyBindings(definition),
              maxBindingsPerCommand,
            );
            const isCustom = !hotkeyBindingListsEqual(bindings, defaultBindings);
            const binding = bindings[0] ?? null;
            const canAddBinding = maxBindingsPerCommand === undefined ||
              bindings.length < maxBindingsPerCommand;
            return (
              <View key={definition.id}>
                {definitionIndex > 0 ? <View className="bg-border-primary" style={styles.rowSeparator} /> : null}
                <View className="flex-row items-start justify-between gap-6 px-4 py-3.5">
                  <View className="min-w-0 flex-1 flex-col gap-1 pr-6" style={styles.rowText}>
                    <Text className="font-semibold text-text-primary leading-tight" style={styles.rowTitle}>
                      {definition.title}
                    </Text>
                    {definition.description ? (
                      <Text className="leading-relaxed text-text-secondary" style={styles.rowDescription}>
                        {definition.description}
                      </Text>
                    ) : null}
                    {bindings.map((binding) => {
                      const conflictIds = conflicts.get(bindingKey(binding)) ?? [];
                      const conflictingTitles = conflictIds
                        .filter((id) => id !== definition.id)
                        .map((id) => titles.get(id))
                        .filter((title): title is string => Boolean(title));
                      return conflictingTitles.length > 0 ? (
                        <Text key={`conflict-${binding}`} className="text-xs text-danger">
                          {formatHotkey(binding)} also triggers {conflictingTitles.join(", ")}.
                        </Text>
                      ) : null;
                    })}
                  </View>
                  <View className="max-w-full flex-shrink flex-col items-end gap-2" style={styles.rowControl}>
                    {usesSingleBinding ? (
                      <View className="flex-row items-center gap-2">
                        <HotkeyCapture
                          onCaptureChange={onCaptureChange}
                          onChange={(value) => {
                            if (value !== null) {
                              onChange(definition.id, [value]);
                            }
                          }}
                          value={binding}
                        />
                        {binding !== null ? (
                          <Pressable
                            accessibilityLabel={`Clear ${definition.title} shortcut ${formatHotkey(binding)}`}
                            accessibilityRole="button"
                            className="h-8 w-8 items-center justify-center rounded-md hover:bg-background-primary"
                            onPress={() => onChange(definition.id, [])}
                          >
                            <SFSymbol name="xmark" size={12} />
                          </Pressable>
                        ) : isCustom ? (
                          <Pressable
                            accessibilityLabel={`Restore ${definition.title} default shortcut`}
                            accessibilityRole="button"
                            className="h-8 w-8 items-center justify-center rounded-md hover:bg-background-primary"
                            onPress={() => onChange(definition.id, defaultBindings)}
                          >
                            <SFSymbol name="arrow.counterclockwise" size={13} />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : bindings.map((binding, bindingIndex) => (
                      <View key={`${binding}-${bindingIndex}`} className="flex-row items-center gap-2">
                        <HotkeyCapture
                          onCaptureChange={onCaptureChange}
                          onChange={(value) => {
                            if (value !== null) {
                              const next = [...bindings];
                              next[bindingIndex] = value;
                              onChange(definition.id, normalizeHotkeyBindings(next));
                            }
                          }}
                          value={binding}
                        />
                        <Pressable
                          accessibilityLabel={`Remove ${definition.title} shortcut ${formatHotkey(binding)}`}
                          accessibilityRole="button"
                          className="rounded-md px-2 py-1.5 hover:bg-background-primary"
                          onPress={() => onChange(
                            definition.id,
                            bindings.filter((_, index) => index !== bindingIndex),
                          )}
                        >
                          <Text className="text-sm text-text-secondary">Remove</Text>
                        </Pressable>
                      </View>
                    ))}
                    {!usesSingleBinding && addingBindingForId === definition.id ? (
                      <View className="flex-row items-center gap-2">
                        <HotkeyCapture
                          onCaptureChange={(isCapturing) => {
                            onCaptureChange?.(isCapturing);
                            if (!isCapturing) {
                              setAddingBindingForId(null);
                            }
                          }}
                          onChange={(value) => {
                            if (value !== null) {
                              onChange(definition.id, normalizeHotkeyBindings([...bindings, value]));
                            }
                            setAddingBindingForId(null);
                          }}
                          value={null}
                        />
                        <Pressable
                          accessibilityRole="button"
                          className="rounded-md px-2 py-1.5 hover:bg-background-primary"
                          onPress={() => setAddingBindingForId(null)}
                        >
                          <Text className="text-sm text-text-secondary">Cancel</Text>
                        </Pressable>
                      </View>
                    ) : !usesSingleBinding ? (
                      <View className="flex-row items-center gap-3">
                        {isCustom ? (
                          <Pressable
                            accessibilityRole="button"
                            className="rounded-md px-2 py-1.5 hover:bg-background-primary"
                            onPress={() => onChange(definition.id, defaultBindings)}
                          >
                            <Text className="text-sm text-text-secondary">Reset</Text>
                          </Pressable>
                        ) : null}
                        {canAddBinding ? (
                          <Pressable
                            accessibilityRole="button"
                            className="rounded-md border border-border-primary bg-background-primary px-3 py-1.5"
                            onPress={() => setAddingBindingForId(definition.id)}
                          >
                            <Text className="text-sm text-text-primary">Add Shortcut</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </View>
      {renderFooter?.()}
    </>
  );
}

export function HotkeyBindingsSettingsPage<HotkeyId extends string>(
  props: HotkeyBindingsSettingsPageProps<HotkeyId>,
) {
  return (
    <View className="flex-1 overflow-hidden" style={styles.page}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex flex-col"
        contentContainerStyle={styles.pageContent}
        horizontal={false}
      >
        <HotkeyBindingsSettingsContent {...props} />
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: "hidden",
  },
  pageContent: {
    alignSelf: "center",
    flexDirection: "column",
    maxWidth: 896,
    paddingHorizontal: 24,
    paddingTop: 56,
    width: "100%",
  },
  rowControl: {
    flexShrink: 1,
    maxWidth: "100%",
  },
  rowText: {
    minWidth: 0,
  },
  rowDescription: {
    fontSize: 12,
  },
  rowTitle: {
    fontSize: 13,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.75,
  },
});
