import type { getDefaultConfig as expoDefaults } from "expo/metro-config";
export interface DesktopMetroOptions { runtimes?: boolean; watch?: boolean }
export type MetroConfiguration = ReturnType<typeof expoDefaults>;
/** Spark-owned project: chooses target defaults and installs desktop/runtime integration. */
export function metroConfig(root: string): MetroConfiguration;
/** Existing Expo project: obtain defaults before applying application customizations. */
export const getDefaultConfig: typeof expoDefaults;
/** Complete an existing Expo project's composition after application customizations. */
export function withSparkMetro<T extends Partial<MetroConfiguration>>(config: T): T;
export function withSparkMetro<T extends Partial<MetroConfiguration>>(config: Promise<T>): Promise<T>;
/** Advanced integration of an already configured desktop Metro instance. */
export function withDesktop<T extends Partial<MetroConfiguration>>(config: T, options?: DesktopMetroOptions): T;
