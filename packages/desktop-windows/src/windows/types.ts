import type { ComponentType } from "react";
import type { WindowOpenOptions } from "../types";
export type WindowComponentLoader<P = Record<string, never>> = () => ComponentType<P> | { default: ComponentType<P> } | Promise<ComponentType<P> | { default: ComponentType<P> }>;
type WithoutIdentity<T> = T extends unknown ? Omit<T, "id" | "component" | "props"> : never;
export type NavigatorWindowOptions = WithoutIdentity<WindowOpenOptions>;
export type WindowConfigEntry<P = any> = { id: string; options?: NavigatorWindowOptions } & (
  | { component: ComponentType<P>; loadComponent?: never }
  | { component?: never; loadComponent: WindowComponentLoader<P> }
);
export type WindowsConfig = Record<string, WindowConfigEntry>;
export type WindowComponentProps<T> = T extends { component: ComponentType<infer P> } ? P : T extends { loadComponent: WindowComponentLoader<infer P> } ? P : never;
