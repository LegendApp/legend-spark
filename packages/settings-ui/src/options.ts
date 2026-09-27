import type {
  WindowStyleMask,
  WindowOptions,
} from "@legendapp/spark-desktop-windows/src/window-manager";

const SETTINGS_WINDOW_DEFAULT_HEIGHT = 640;
const SETTINGS_WINDOW_DEFAULT_WIDTH = 820;
const SETTINGS_WINDOW_MIN_HEIGHT = 500;
const SETTINGS_WINDOW_MIN_WIDTH = 720;

export type CreateSettingsWindowOptionsInput = Omit<
  WindowOptions,
  "deferOrderFront" | "windowStyle" | "transparentBackground"
> & {
  defaultPageId?: string;
  windowStyle?: WindowOptions["windowStyle"];
  transparentBackground?: boolean;
};

export function createSettingsWindowOptions({
  defaultPageId,
  title = "Settings",
  transparentBackground = true,
  windowStyle,
  ...options
}: CreateSettingsWindowOptionsInput = {}): WindowOptions {
  const initialProperties = defaultPageId || options.initialProperties
    ? {
        ...(options.initialProperties ?? {}),
        ...(defaultPageId ? { defaultPageId } : {}),
      }
    : undefined;

  return {
    ...options,
    deferOrderFront: true,
    initialProperties,
    title,
    transparentBackground,
    windowStyle: {
      hasToolbar: true,
      height: SETTINGS_WINDOW_DEFAULT_HEIGHT,
      mask: [
        "Titled" as WindowStyleMask,
        "Closable" as WindowStyleMask,
        "Resizable" as WindowStyleMask,
        "FullSizeContentView" as WindowStyleMask,
        "UnifiedTitleAndToolbar" as WindowStyleMask,
      ],
      minHeight: SETTINGS_WINDOW_MIN_HEIGHT,
      minWidth: SETTINGS_WINDOW_MIN_WIDTH,
      titlebarAppearsTransparent: true,
      titlebarSeparatorStyle: "none",
      titleVisibility: "visible",
      toolbarStyle: "unified",
      width: SETTINGS_WINDOW_DEFAULT_WIDTH,
      ...(windowStyle ?? {}),
    },
  };
}
