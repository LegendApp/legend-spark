import type { ExpoConfig } from "expo/config";
import type { WindowConfiguration } from "@legendapp/spark-window-options";
export type { WindowConfiguration } from "@legendapp/spark-window-options";
export type SparkPlatform = "macos" | "windows" | "ios" | "android" | "web";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface UpdateConfiguration { feedURL: string; publicKey: string; maximumDeltas?: number }
export interface DocumentType { name: string; contentTypes: string[]; role?: "Editor" | "Viewer" }
export type HelperTarget = "macos-arm64" | "macos-x64" | "windows-arm64" | "windows-x64";
export type HelperConfiguration = string | Partial<Record<HelperTarget, { directory: string; executable: string }>>;
export interface MacOSConfiguration {
  bundleIdentifier: string;
  buildNumber?: string;
  infoPlist?: Record<string, JsonValue>;
  entitlements?: Record<string, JsonValue>;
  /**
   * Compile the in-app test driver into release builds too; Debug builds always have it. Default false: release builds
   * contain no driver code, which the CLI checks after each release build. For apps the release gate drives, such as
   * the Kitchen Sink; never for apps you distribute (docs/test-driver.md#builds).
   */
  testDriverInRelease?: boolean;
  lifecycle?: MacOSLifecycle;
}
export interface SigningConfiguration {
  macos?: { identity?: string; teamId?: string; entitlementsByPath?: Record<string, Record<string, JsonValue>> };
}
export type CustomizeProvider = { kind: 'cli'; tool: 'codex' | 'claude'; model?: string } | { kind: 'local' | 'remote'; endpoint: string; model: string };
export interface CustomizeConfiguration {
  repository: string;
  tag?: string;
  /** Source snapshot root, relative to and an ancestor of the app project. files are relative to this root. */
  sourceRoot?: string;
  files: string[];
  githubClientId?: string;
  toolkitRepository?: string;
  toolkitTag?: string;
  ui?: 'default' | 'custom';
  provider?: CustomizeProvider;
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
  customize?: false | CustomizeConfiguration;
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
