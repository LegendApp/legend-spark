import { useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSheet from "./SheetNativeComponent";
export interface SheetProps extends Omit<SpecializedViewProps, "children"> {
  /** Controlled visibility. */
  visible: boolean;
  /** React content shown in the sheet, at its own layout size: give it a width and height (or content that sizes it). */
  children: ReactNode;
  /** Escape or ⌘. in the sheet; set `visible` to false in it to close. The sheet never closes itself. */
  onCancel?: () => void;
}
export function getSheetAvailability() { return macosViewAvailability("SparkSheet"); }
/** A document-modal sheet on this view's window, hosting React content (a form, say). Render it anywhere in the window. */
export function Sheet({ visible, children, onCancel, ref, onError, style, ...props }: SheetProps) {
  if (typeof visible !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Invalid sheet visibility");
  callback(onCancel, "onCancel");
  const control = useControl({ ref, onError }, getSheetAvailability());
  const [size, setSize] = useState<{ width: number; height: number }>();
  // The content stays mounted until the sheet has finished closing, so it does not animate away blank.
  const [contentMounted, setContentMounted] = useState(visible);
  if (visible && !contentMounted) setContentMounted(true);
  function dismissed() {
    if (!control.mounted() || visible) return;
    setContentMounted(false); setSize(undefined);
  }
  function measured(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
  }
  if (control.failed) return visible ? <View {...props} ref={control.ref} style={style} accessibilityViewIsModal>{children}</View> : null;
  return <NativeSheet {...props} ref={control.ref} style={[{ position: "absolute", width: 0, height: 0 }, style]} visible={visible} contentWidth={size?.width ?? 0} contentHeight={size?.height ?? 0}
    onCancel={() => { if (control.mounted()) onCancel?.(); }} onDismiss={dismissed}>
    {contentMounted ? <View collapsable={false} style={{ position: "absolute", left: 0, top: 0 }} onLayout={measured}>{children}</View> : null}
  </NativeSheet>;
}
