import { useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, finite, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativePopover from "./PopoverNativeComponent";
export interface PopoverAnchorRect { x: number; y: number; width: number; height: number }
export interface PopoverProps extends SpecializedViewProps {
  /** Controlled visibility. */
  visible: boolean;
  /** React content shown in the popover. Give it a width; without one, text wraps to the anchor's width. */
  content: ReactNode;
  /** Called when AppKit closes a visible popover (a click outside or Escape); set `visible` to false in it. */
  onClose?: () => void;
  /** Preferred side of the anchor: `bottom` (default), `top`, `leading` or `trailing`. AppKit flips it when there is no room. */
  edge?: "bottom" | "top" | "leading" | "trailing";
  /** `transient` (default) closes on any click outside; `semitransient` stays open for clicks in other windows; `applicationDefined` closes only when `visible` turns false. */
  behavior?: "transient" | "semitransient" | "applicationDefined";
  /** A rect within this view to point at, such as a text selection. Defaults to the whole view. */
  anchorRect?: PopoverAnchorRect;
}
export function getPopoverAvailability() { return macosViewAvailability("SparkPopover"); }
/** AppKit's NSPopover, anchored to this view (its children) or to `anchorRect` within it, hosting React `content`. */
export function Popover({ visible, content, onClose, edge = "bottom", behavior = "transient", anchorRect, ref, onError, children, ...props }: PopoverProps) {
  if (typeof visible !== "boolean" || !["bottom", "top", "leading", "trailing"].includes(edge) || !["transient", "semitransient", "applicationDefined"].includes(behavior)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid popover options");
  callback(onClose, "onClose");
  if (anchorRect !== undefined) {
    if (!anchorRect || typeof anchorRect !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Invalid popover anchorRect");
    finite(anchorRect.x, "anchorRect x", -Infinity); finite(anchorRect.y, "anchorRect y", -Infinity); finite(anchorRect.width, "anchorRect width"); finite(anchorRect.height, "anchorRect height");
  }
  const control = useControl({ ref, onError }, getPopoverAvailability());
  const [size, setSize] = useState<{ width: number; height: number }>();
  const shown = visible && !control.failed;
  if (!shown && size) setSize(undefined);
  function measured(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
  }
  if (control.failed) return <View {...props} ref={control.ref}>{children}</View>;
  return <NativePopover {...props} ref={control.ref} visible={shown} contentWidth={size?.width ?? 0} contentHeight={size?.height ?? 0} edge={edge} behavior={behavior}
    anchorX={anchorRect?.x ?? 0} anchorY={anchorRect?.y ?? 0} anchorWidth={anchorRect?.width ?? 0} anchorHeight={anchorRect?.height ?? 0} onClose={() => { if (control.mounted()) onClose?.(); }}>
    <View collapsable={false}>{children}</View>
    {shown ? <View collapsable={false} style={{ position: "absolute", left: 0, top: 0 }} onLayout={measured}>{content}</View> : null}
  </NativePopover>;
}
