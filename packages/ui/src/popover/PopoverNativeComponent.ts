import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  /** Shown once the content has a size. The second child is the content; it is hosted in the NSPopover. */
  visible?: CodegenTypes.WithDefault<boolean, false>;
  contentWidth?: CodegenTypes.Double;
  contentHeight?: CodegenTypes.Double;
  edge?: CodegenTypes.WithDefault<"bottom" | "top" | "leading" | "trailing", "bottom">;
  behavior?: CodegenTypes.WithDefault<"transient" | "semitransient" | "applicationDefined", "transient">;
  /** Positioning rect in the view's coordinates; used when anchorWidth or anchorHeight is positive, else the view's bounds. */
  anchorX?: CodegenTypes.Double;
  anchorY?: CodegenTypes.Double;
  anchorWidth?: CodegenTypes.Double;
  anchorHeight?: CodegenTypes.Double;
  /** AppKit closed the popover itself (a click outside, Escape). */
  onClose?: CodegenTypes.DirectEventHandler<Readonly<{}>>;
}

export default codegenNativeComponent<NativeProps>("SparkPopover") as HostComponent<NativeProps>;
