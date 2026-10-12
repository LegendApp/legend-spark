import { Component, Fragment, Suspense, createContext, lazy, useLayoutEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import type { ThreadedComponent } from "@react-native-runtimes/core";
import { WindowProvider } from "./WindowProvider";
import type { ErrorFallbackProps, IsolatedRuntime, WindowErrorEvent, WindowInstance } from "./types";

type Props = Record<string, unknown>;
/**
 * Root props of entries without a fixed ID; entries with `id` receive their props directly, as before.
 * Native restarts root props unchanged after a JavaScript reload. Pooled windows also carry `use`: 0 while warm
 * (no instance, nothing rendered), then a new number for each open, set natively when the window is taken.
 */
export interface WindowRootProps { props?: Props; sparkWindow: { id: string; use?: number } }
/** Whether a window's content is throttled (hidden, minimized or fully covered). */
export interface ThrottleStore { subscribe(listener: () => void): () => void; get(): boolean }
export interface RootHost {
  /** Idempotent: the live instance, or one recreated for a root restarted after a reload. */
  /** `props`: what the window was opened with, undefined when it had none. */
  adopt(window: { id: string; name: string; props: Props | undefined; use?: number }): WindowInstance;
  /** A pooled window's root rendered with nothing to show: the window is warm. */
  warm(id: string): void;
  /** The window's content committed its first render. */
  committed(instance: WindowInstance): void;
  throttle(instance: WindowInstance): ThrottleStore;
  report(event: WindowErrorEvent): void;
  fallback: ComponentType<ErrorFallbackProps>;
}
export interface RootContent { resolved(): ComponentType<Props> | undefined; load(): Promise<ComponentType<Props>>; runtime?: IsolatedRuntime; throttle?: boolean }

export const WindowInstanceContext = createContext<WindowInstance | null>(null);

interface BoundaryProps { host: RootHost; instance: WindowInstance; children: ReactNode }
class WindowErrorBoundary extends Component<BoundaryProps, { error: unknown; failed: boolean; generation: number }> {
  state = { error: undefined as unknown, failed: false, generation: 0 };
  static getDerivedStateFromError(error: unknown) { return { error, failed: true }; }
  componentDidCatch(error: unknown) {
    const { host, instance } = this.props;
    host.report({ windowId: instance.id, name: instance.name, phase: "render", error });
  }
  render() {
    const { host, instance, children } = this.props;
    if (this.state.failed) {
      const Fallback = host.fallback;
      return <Fallback windowId={instance.id} error={this.state.error}
        retry={() => this.setState(state => ({ error: undefined, failed: false, generation: state.generation + 1 }))}
        close={() => { instance.close().catch(error => host.report({ windowId: instance.id, name: instance.name, phase: "cleanup", error })); }} />;
    }
    return <Fragment key={this.state.generation}>{children}</Fragment>;
  }
}

/** English defaults; pass `errorFallback` to localize. */
export function DefaultErrorFallback({ retry, close }: ErrorFallbackProps) {
  const color = useColorScheme() === "dark" ? "#ffffff" : "#1d1d1f";
  return <View style={styles.fallback} testID="spark-window-error" accessibilityRole="alert">
    <Text style={[styles.title, { color }]}>This window stopped working.</Text>
    <Text style={{ color, opacity: 0.7 }}>Other windows are unaffected.</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" testID="spark-window-error-retry" onPress={retry} style={[styles.button, { borderColor: color }]}><Text style={{ color }}>Try again</Text></Pressable>
      <Pressable accessibilityRole="button" testID="spark-window-error-close" onPress={close} style={[styles.button, { borderColor: color }]}><Text style={{ color }}>Close window</Text></Pressable>
    </View>
  </View>;
}

/** A fixed-ID root's own props: React Native adds `rootTag` to them. Undefined when there are none. */
function openedProps({ rootTag: _rootTag, ...props }: Props): Props | undefined {
  return Object.keys(props).length ? props : undefined;
}

// Background render throttling: suspending with a thenable that never settles hides the committed content's views and
// keeps its state; its layout effects are cleaned up and run again when it renders, and updates inside wait until then.
// The window can show its background for a frame when it becomes visible, before that render (AppKit reports
// visibility after the change). A bare thenable keeps no callbacks, so freezing retains nothing.
const never = { then() {} };
function Freeze({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  if (frozen) throw never;
  return children;
}
function useThrottled(store: ThrottleStore) { return useSyncExternalStore(store.subscribe, store.get); }
function useCommitted(host: RootHost, instance: WindowInstance) { useLayoutEffect(() => host.committed(instance), [host, instance]); }
function useWarm(host: RootHost, id: string) { useLayoutEffect(() => host.warm(id), [host, id]); }
function Warm({ host, id }: { host: RootHost; id: string }) { useWarm(host, id); return null; }

export function createWindowRoot(host: RootHost, content: RootContent, name: string, fixedId?: string): ComponentType<Props> {
  const { runtime } = content;
  // A root restarted after a reload can render before open() or prefetch() loaded the component.
  const Loaded = lazy(async () => ({ default: await content.load() }));
  function WindowBody({ rootProps }: { rootProps: Props }) {
    const wrapped = rootProps as Partial<WindowRootProps>;
    const props = fixedId ? rootProps : wrapped.props ?? {};
    // Adopt once per mount (and pooled use), so a late re-render can never pick up a later window reusing the ID.
    const [instance] = useState(() => host.adopt({ id: fixedId ?? wrapped.sparkWindow?.id ?? "", name, props: fixedId ? openedProps(rootProps) : wrapped.props, use: wrapped.sparkWindow?.use }));
    const [throttle] = useState(() => host.throttle(instance));
    const frozen = useThrottled(throttle);
    useCommitted(host, instance);
    const Content = content.resolved();
    const body = runtime
      ? <runtime.module.Threaded component={Content as ThreadedComponent<Props>} props={props} runtimeName={runtime.isolated} style={styles.fill} surfaceKey={instance.id} testID={`spark-window-surface-${instance.id}`} />
      : Content ? <Content {...props} /> : <Suspense fallback={null}><Loaded {...props} /></Suspense>;
    return <WindowProvider id={instance.id}>
      <WindowInstanceContext.Provider value={instance}>
        <WindowErrorBoundary host={host} instance={instance}>
          {content.throttle ? <Suspense fallback={null}><Freeze frozen={frozen}>{body}</Freeze></Suspense> : body}
        </WindowErrorBoundary>
      </WindowInstanceContext.Provider>
    </WindowProvider>;
  }
  function WindowRoot(rootProps: Props) {
    const window = fixedId ? undefined : (rootProps as Partial<WindowRootProps>).sparkWindow;
    // A warm pooled window renders nothing; each use mounts fresh content.
    if (window?.use === 0) return <Warm host={host} id={window.id} />;
    return <Fragment key={window?.use}><WindowBody rootProps={rootProps} /></Fragment>;
  }
  return WindowRoot;
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { fontSize: 17, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  button: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
});
