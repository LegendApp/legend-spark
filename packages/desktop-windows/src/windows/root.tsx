import { Component, Fragment, Suspense, createContext, lazy, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import type { ThreadedComponent } from "@react-native-runtimes/core";
import { WindowProvider } from "./WindowProvider";
import type { ErrorFallbackProps, IsolatedRuntime, WindowErrorEvent, WindowInstance } from "./types";

type Props = Record<string, unknown>;
/**
 * Root props of entries without a fixed ID; entries with `id` receive their props directly, as before.
 * Native restarts root props unchanged after a JavaScript reload.
 */
export interface WindowRootProps { props?: Props; sparkWindow: { id: string } }
export interface RootHost {
  /** Idempotent: the live instance, or one recreated for a root restarted after a reload. */
  adopt(window: { id: string; name: string }): WindowInstance;
  report(event: WindowErrorEvent): void;
  fallback: ComponentType<ErrorFallbackProps>;
}
export interface RootContent { resolved(): ComponentType<Props> | undefined; load(): Promise<ComponentType<Props>>; runtime?: IsolatedRuntime }

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

export function createWindowRoot(host: RootHost, content: RootContent, name: string, fixedId?: string): ComponentType<Props> {
  const { runtime } = content;
  // A root restarted after a reload can render before open() or prefetch() loaded the component.
  const Loaded = lazy(async () => ({ default: await content.load() }));
  function WindowRoot(rootProps: Props) {
    const wrapped = rootProps as Partial<WindowRootProps>;
    const props = fixedId ? rootProps : wrapped.props ?? {};
    // Adopt once per mount, so a late re-render can never pick up a later window reusing the ID.
    const [instance] = useState(() => host.adopt({ id: fixedId ?? wrapped.sparkWindow?.id ?? "", name }));
    const Content = content.resolved();
    const body = runtime
      ? <runtime.module.Threaded component={Content as ThreadedComponent<Props>} props={props} runtimeName={runtime.isolated} style={styles.fill} surfaceKey={instance.id} testID={`spark-window-surface-${instance.id}`} />
      : Content ? <Content {...props} /> : <Suspense fallback={null}><Loaded {...props} /></Suspense>;
    return <WindowProvider id={instance.id}>
      <WindowInstanceContext.Provider value={instance}>
        <WindowErrorBoundary host={host} instance={instance}>{body}</WindowErrorBoundary>
      </WindowInstanceContext.Provider>
    </WindowProvider>;
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
