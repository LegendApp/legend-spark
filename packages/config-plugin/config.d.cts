export function readConfig(root: string, target?: string): any;
export function prepareConfig(root: string): any;
export function toExpo(value: unknown, target?: string): any;
export function writeUpdates(root: string, updates: unknown): void;

export function isUniversal(root: string): boolean;
export function isExpoProject(root: string): boolean;
export function statePath(root: string, name: string, target?: string): string;
export function selectTarget(platforms: string[], target?: string): string;
export function expoConfig(root: string): any;

export function supportedPlatforms(root: string): string[];
export function developmentConfig(value: any, target?: string): any;

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
