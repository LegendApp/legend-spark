import type { ExpoConfig } from "@expo/config-types";
import type { WindowConfiguration } from "@legendapp/spark-window-options";
export type { WindowConfiguration } from "@legendapp/spark-window-options";
export type SparkPlatform = "macos" | "windows" | "ios" | "android" | "web";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface UpdateConfiguration { feedURL: string; publicKey: string }
export interface DocumentType { name: string; contentTypes: string[]; role?: "Editor" | "Viewer" }
export type HelperTarget = "macos-arm64" | "macos-x64" | "windows-arm64" | "windows-x64";
export type HelperConfiguration = string | Partial<Record<HelperTarget, { directory: string; executable: string }>>;
export interface MacOSConfiguration {
  bundleIdentifier: string;
  buildNumber?: string;
  infoPlist?: Record<string, JsonValue>;
  entitlements?: Record<string, JsonValue>;
  lifecycle?: MacOSLifecycle;
}
export interface SigningConfiguration {
  macos?: { identity?: string; teamId?: string; entitlementsByPath?: Record<string, Record<string, JsonValue>> };
}
/** Spark-owned settings carried inside Expo's extra.spark. */
export interface SparkSettings {
  projectId: string;
  window?: WindowConfiguration;
  documentTypes?: DocumentType[];
  menuBarOnly?: boolean;
  updates?: UpdateConfiguration;
  include?: string[];
  signing?: SigningConfiguration;
  helpers?: Record<string, HelperConfiguration>;
  supportedPlatforms?: SparkPlatform[];
}
/** Expo retains ownership of its configuration; Spark only adds desktop fields. */
export type ExpoOverrides = Partial<Omit<ExpoConfig, "platforms" | "extra">> & {
  platforms?: SparkPlatform[];
  extra?: Record<string, unknown>;
  macos?: MacOSConfiguration;
  windows?: { namespace?: string; displayName?: string; packageGuid?: string; projectGuid?: string; [key: string]: unknown };
  autolinking?: { exclude?: string[]; [key: string]: unknown };
};
export interface SparkApplicationConfig extends Omit<SparkSettings, "supportedPlatforms"> {
  $schema?: string;
  name: string;
  version: string;
  extends?: never;
  platforms?: SparkPlatform[];
  macos?: MacOSConfiguration;
  scheme?: string | string[];
  expo?: ExpoOverrides;
  expoByPlatform?: Partial<Record<SparkPlatform, ExpoOverrides>>;
}
export type SparkExpoProjectConfig = Omit<SparkApplicationConfig, "extends" | "name" | "version" | "platforms"> & {
  extends: "expo";
  name?: string;
  version?: string;
  platforms: SparkPlatform[];
};
export type SparkConfig = SparkApplicationConfig | SparkExpoProjectConfig;
export type ResolvedExpoConfig = Omit<ExpoOverrides, "platforms" | "extra"> & {
  platforms: SparkPlatform[];
  extra?: Record<string, unknown> & { spark?: SparkSettings };
};
export interface ResolvedConfig { expo: ResolvedExpoConfig }
export type GeneratedExpoConfig = ResolvedExpoConfig & { name: string; slug: string; version: string; extra: Record<string, unknown> & { spark: SparkSettings } };
export function readConfig(root: string, target?: string): ResolvedConfig;
export function prepareConfig(root: string): ResolvedConfig;
/** Accepts untrusted JSON; validates Spark-owned settings before returning Expo configuration. */
export function toExpo(value: unknown, target?: string): { expo: GeneratedExpoConfig };
export function writeUpdates(root: string, updates: UpdateConfiguration): void;
export function isUniversal(root: string): boolean;
export function isExpoProject(root: string): boolean;
export function statePath(root: string, name: string, target?: string): string;
export function selectTarget(platforms: readonly string[], target?: string): SparkPlatform;
export function expoConfig(root: string): ResolvedExpoConfig;
export function supportedPlatforms(root: string): SparkPlatform[];
export function developmentConfig(value: unknown, target?: string): GeneratedExpoConfig;
export function applySelection(root: string, expo: ResolvedExpoConfig): ResolvedExpoConfig;

/** macOS native startup policy. Omitted fields keep Spark's normal host behavior. */
export type MacOSLifecycle = {
  appearance?: "system" | "light" | "dark";
  /** Linked NSObject classes conforming to SparkStartupPlugin. No automatic discovery. */
  plugins?: string[];
  mainWindow?: {
    hidden?: boolean;
    glass?: boolean;
    autosaveName?: string;
    backgroundColors?: { light: string; dark: string };
    closeBehavior?: "close" | "hide" | "request";
    reopenBehavior?: "default" | "manual" | "visibleWindows";
    toolbarStyle?: "unified" | "expanded";
    titlebarSeparatorStyle?: "automatic" | "none" | "line" | "shadow";
  };
};
