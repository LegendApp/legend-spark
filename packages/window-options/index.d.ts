export interface WindowSize { width: number; height: number }
/** Initial outer frame dimensions in logical units, matching the runtime window API. */
export interface WindowConfiguration {
  title?: string;
  size?: WindowSize;
  minSize?: WindowSize | null;
  maxSize?: WindowSize | null;
  resizable?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  alwaysOnTop?: boolean;
  transparent?: boolean;
  hasShadow?: boolean;
  restoreBounds?: boolean;
  titleBarStyle?: "default" | "overlay" | "hidden" | "borderless";
  appearance?: "system" | "light" | "dark";
  backgroundColor?: string;
  macos?: {
    backgroundMaterial?: "none" | "sidebar" | "windowBackground" | "hudWindow" | "popover";
    titleBar?: { trafficLights?: boolean };
  };
}
export function validateWindow(options: unknown): WindowConfiguration;
export function nativeWindowOptions(options: unknown): Record<string, string | number | boolean>;
export const schema: Record<string, unknown>;
