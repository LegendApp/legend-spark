import type { ComponentType } from "react";
import { lazy, Suspense } from "react";
import { AppRegistry } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { openWindow, closeWindow, showWindow } from "../api";
import type { CloseResult, WindowInfo, WindowOpenOptions } from "../types";
import { keys, object, validateOptions, windowId } from "../validation";
import { Platform } from "react-native";
import type { NavigatorWindowOptions, WindowsConfig, WindowComponentProps } from "./types";
import { withWindowProvider } from "./WindowProvider";
export type NavigatorOpenOptions<P> = { props: P; options?: NavigatorWindowOptions };
type OpenArguments<P> = {} extends P ? [options?: { props?: P; options?: NavigatorWindowOptions }] : [options: NavigatorOpenOptions<P>];
export interface WindowsNavigator<T extends WindowsConfig> {
  open<K extends keyof T>(name: K, ...args: OpenArguments<WindowComponentProps<T[K]>>): Promise<WindowInfo>;
  close(name: keyof T): Promise<CloseResult>;
  show(name: keyof T): Promise<void>;
  getId(name: keyof T): string;
  prefetch(name: keyof T): Promise<void>;
}
const registrations = new Set<string>();
function component(value: unknown): value is ComponentType<any> {
  return typeof value === "function" || (!!value && typeof value === "object" && [Symbol.for("react.memo"), Symbol.for("react.forward_ref"), Symbol.for("react.lazy")].includes((value as any).$$typeof));
}
export function createWindowsNavigator<T extends WindowsConfig>(config: T): WindowsNavigator<T> {
  object(config, "navigator configuration");
  const ids = new Set<string>();
  for (const entry of Object.values(config)) {
    object(entry, "window registration"); keys(entry, ["id", "component", "loadComponent", "options"]); windowId(entry.id);
    if (entry.id === "main" || ids.has(entry.id) || registrations.has(entry.id)) throw new SparkError("E_ALREADY_EXISTS", "Window ID is already registered or reserved");
    ids.add(entry.id);
    if ((entry.component !== undefined) === (entry.loadComponent !== undefined) || (entry.component !== undefined && !component(entry.component)) || (entry.loadComponent !== undefined && typeof entry.loadComponent !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Register exactly one component or loadComponent");
    if (entry.options) {
      object(entry.options, "registration options");
      for (const key of ["id", "component", "props"]) if (key in entry.options) throw new SparkError("E_INVALID_ARGUMENT", "Navigator identity and props cannot be overridden in options");
      validateOptions({ ...entry.options, id: entry.id, component: "registration" } as WindowOpenOptions, Platform.OS, true);
    }
  }
  const registry = new Map<keyof T, { id: string; moduleName: string; options: NavigatorWindowOptions; load(): Promise<void> }>();
  for (const name of Object.keys(config) as (keyof T)[]) {
    const entry = config[name], id = entry.id, moduleName = `spark.window.${id}`;
    let resolved: ComponentType<any> | undefined = entry.component ? withWindowProvider(entry.component, id) : undefined;
    let pending: Promise<void> | undefined;
    const load = async () => {
      if (resolved) return;
      if (!pending) pending = Promise.resolve().then(() => entry.loadComponent!()).then(value => {
        const result = value && typeof value === "object" && "default" in value ? value.default : value;
        if (!component(result)) throw new SparkError("E_INVALID_DATA", "Window loader did not return a React component");
        resolved = withWindowProvider(result, id);
      }).catch(cause => { pending = undefined; throw cause; });
      await pending;
    };
    // Native surfaces restart on reload before the app can call open or prefetch.
    const LoadedWindow = lazy(async () => { await load(); return { default: resolved! }; });
    const RestartedWindow = (props: any) => <Suspense fallback={null}><LoadedWindow {...props} /></Suspense>;
    AppRegistry.registerComponent(moduleName, () => resolved ?? RestartedWindow);
    registrations.add(id);
    registry.set(name, { id, moduleName, options: JSON.parse(JSON.stringify(entry.options ?? {})), load });
  }
  const get = (name: keyof T) => {
    const value = registry.get(name); if (!value) throw new SparkError("E_NOT_FOUND", `Unknown window: ${String(name)}`); return value;
  };
  return {
    async open(name, ...args) {
      const registration = get(name), request = args[0] ?? {};
      object(request, "open request"); keys(request, ["props", "options"]);
      if (request.options) { object(request.options, "open options"); for (const key of ["id", "component", "props"]) if (key in request.options) throw new SparkError("E_INVALID_ARGUMENT", "Navigator identity and props cannot be overridden in options"); }
      const options = { ...registration.options, ...request.options, id: registration.id, component: registration.moduleName, props: request.props } as WindowOpenOptions;
      validateOptions(options, Platform.OS, true);
      const snapshot = JSON.parse(JSON.stringify(options));
      // Always load before native creation. Failed loaders remain retryable and leave no native shell.
      await registration.load(); return openWindow(snapshot);
    },
    async close(name) { return closeWindow(get(name).id); },
    async show(name) { await showWindow(get(name).id); },
    getId(name) { return get(name).id; },
    async prefetch(name) { await get(name).load(); },
  };
}
