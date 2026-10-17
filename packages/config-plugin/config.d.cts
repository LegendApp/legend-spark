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
  /**
   * The app icon, relative to the project: an Icon Composer `.icon` document (the macOS 26 default, dark, clear and
   * tinted styles) or a PNG. Defaults to `expo.icon` (docs/configuration.md#app-icons).
   */
  icon?: string;
  infoPlist?: Record<string, JsonValue>;
  entitlements?: Record<string, JsonValue>;
  /**
   * Compile the in-app test driver into release builds too; Debug builds always have it. Default false: release builds
   * contain no driver code, which the CLI checks after each release build. For apps the release gate drives, such as
   * the Kitchen Sink; never for apps you distribute (docs/test-driver.md#builds).
   */
  testDriverInRelease?: boolean;
  /**
   * Compile the test driver's trackpad gesture and extra mouse button synthesis, which uses private CoreGraphics
   * event functions (SPARK_TEST_DRIVER_PRIVATE_EVENTS). Default false: the functions' names are then absent from the
   * binary, as App Store review requires. Test builds only (docs/test-driver.md#private-event-functions).
   */
  testDriverPrivateEvents?: boolean;
  lifecycle?: MacOSLifecycle;
  /**
   * Opt in to the restricted entitlements of Sign in with Apple (`com.apple.developer.applesignin`) and passkeys
   * (`webcredentials:<domain>` in `com.apple.developer.associated-domains`). Both need a team-signed build with a
   * provisioning profile; without them the APIs report `missing-entitlement` (docs/authentication.md#entitlements).
   */
  authentication?: { signInWithApple?: boolean; passkeyDomains?: string[] };
  /**
   * Opt in to the hardened-runtime entitlements `@legendapp/spark/capture` and speech recognition need: `camera` adds
   * `com.apple.security.device.camera`, `microphone` adds `com.apple.security.device.audio-input`. Each needs its usage
   * description in `infoPlist` (NSCameraUsageDescription, NSMicrophoneUsageDescription). Without them a hardened-runtime
   * build reports `missing-entitlement` (docs/capture.md#entitlements).
   */
  capture?: { camera?: boolean; microphone?: boolean };
  /**
   * Helpers (named in `helpers`) that run as launchd daemons through @legendapp/spark/privileged-helper. spark build writes
   * Contents/Library/LaunchDaemons/<bundleIdentifier>.<name>.plist for each; nothing is added without this option. They
   * need a team-signed build (docs/privileged-helper.md#configuration).
   */
  privilegedHelpers?: string[];
  /**
   * The App Sandbox (Mac App Store style) variant that `spark build --sandbox` makes. Every process is sandboxed: the
   * main executable carries the app's entitlements plus `entitlements` (com.apple.security.* keys; app-sandbox is
   * implied), every other process only app-sandbox and inherit. The variant ships without Sparkle updates and
   * privileged helpers (docs/app-sandbox.md).
   */
  sandbox?: { entitlements?: Record<string, JsonValue> };
  /** App Intents for Shortcuts, Spotlight and Siri, compiled into the app by spark build (docs/app-intents.md). */
  appIntents?: AppIntentConfiguration[];
  /** Enums App Intent parameters can take: Shortcuts offers their cases in a picker, and App Shortcut phrases can name them. */
  appEnums?: AppEnumConfiguration[];
  /** Entities App Intent parameters can take, which JavaScript lists and finds (addAppEntityQueryHandler). */
  appEntities?: AppEntityConfiguration[];
}
/**
 * Text Shortcuts, Spotlight and Siri show: as written, or translated into each of the app's localizations
 * ({ "en": "Show Recipe", "ar": "اعرض الوصفة" }), which spark build compiles into a strings catalog.
 */
export type LocalizedText = string | Record<string, string>;
export interface AppIntentConfiguration {
  /** Letters and digits; the intent's identity, so shortcuts that use it break when it changes. */
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  /** `type` is string, number, integer, boolean, or the id of an enum (appEnums) or entity (appEntities). */
  parameters?: { name: string; title: LocalizedText; type: string; optional?: boolean; default?: string | number | boolean }[];
  /** How Shortcuts shows the action, naming parameters as `${name}`: "Show ${recipe} for ${servings}". */
  parameterSummary?: LocalizedText;
  /** The handler returns text, which the system shows and passes to the next action. Default false. */
  returnsText?: boolean;
  /** Bring the app to the front when the intent runs. Default false. */
  openApp?: boolean;
  /** An App Shortcut, available without setup. Each phrase names the app once as `${applicationName}`, and may name enum parameters as `${name}`. */
  shortcut?: { phrases: LocalizedText[]; shortTitle: LocalizedText; systemImage: string };
}
export interface AppEnumConfiguration {
  /** Letters and digits, starting with an uppercase letter; parameters name it as their type. */
  id: string;
  title: LocalizedText;
  /** `value` (letters and digits, starting with a lowercase letter) is what JavaScript gets. */
  cases: { value: string; title: LocalizedText }[];
}
export interface AppEntityConfiguration {
  /** Letters and digits, starting with an uppercase letter; parameters name it as their type. */
  id: string;
  title: LocalizedText;
}
export interface SigningConfiguration {
  macos?: { identity?: string; teamId?: string; entitlementsByPath?: Record<string, Record<string, JsonValue>> };
}
/** Spark-owned settings carried inside Expo's extra.spark. */
export interface SparkSettings {
  projectId: string;
  window?: WindowConfiguration;
  /**
   * The languages the app is localized in, development language first. macOS lists them as the bundle's
   * localizations: AppKit and Spark show native strings in the first of the user's languages listed here,
   * and System Settings offers a per-app language when there are several. Windows does not use them yet.
   */
  localizations?: string[];
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
