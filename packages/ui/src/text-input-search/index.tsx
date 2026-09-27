import { createElement, useCallback, useImperativeHandle, useRef, type ElementRef, type Ref } from "react";
import { Text, View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl, useTextValue } from "../control";
import { macosViewAvailability, appearance } from "../specialized";
import type { ControlRef, ControlledTextInputProps, UncontrolledTextInputProps } from "../types";
import NativeSearch, { Commands } from "./TextInputSearchNativeComponent";
export type TextInputSearchProps = (Omit<ControlledTextInputProps, "ref"> | Omit<UncontrolledTextInputProps, "ref">) & {
  appearance?: "dark" | "light" | "system";
  placeholder?: string;
  ref?: Ref<TextInputSearchRef>;
};
export interface TextInputSearchRef extends ControlRef { focus(): void; blur(): void }
export function getSearchAvailability() { return macosViewAvailability("TextInputSearch"); }
export function TextInputSearch({ ref, appearance: theme = "system", placeholder = "", ...props }: TextInputSearchProps) {
  appearance(theme);
  if (typeof placeholder !== "string") throw new SparkError("E_INVALID_ARGUMENT", "Expected search placeholder");
  const layout = useRef<ControlRef>(null), native = useRef<ElementRef<typeof NativeSearch>>(null);
  const control = useControl({ ...props, ref: layout }, getSearchAvailability()), value = useTextValue(props);
  const nativeRef = useCallback((view: ElementRef<typeof NativeSearch> | null) => { native.current = view; control.ref(view); }, [control.ref]);
  useImperativeHandle(ref, () => ({
    measureInWindow(callback) { if (!layout.current) throw new SparkError("E_CLOSED", "Search input is not mounted"); layout.current.measureInWindow(callback); },
    focus() { if (!native.current) throw new SparkError("E_CLOSED", "Search input is not mounted or available"); Commands.focus(native.current); },
    blur() { if (!native.current) throw new SparkError("E_CLOSED", "Search input is not mounted or available"); Commands.blur(native.current); },
  }), []);
  function changed(event: NativeSyntheticEvent<{ text: string; eventCount: number }>) {
    if (!control.active()) return;
    const data = event?.nativeEvent;
    if (typeof data?.text !== "string" || !Number.isSafeInteger(data.eventCount) || data.eventCount < 1 || data.eventCount > 2147483647) { control.error(new SparkError("E_INVALID_DATA", "Invalid search input event")); return; }
    if (value.acknowledge(data.eventCount)) props.onChangeText?.(data.text);
  }
  if (control.failed) return <View ref={control.ref} style={props.style} testID={props.testID} accessible accessibilityLabel={props.accessibilityLabel} accessibilityState={{ disabled: true }}><Text>{value.controlled ? value.text : value.defaultText}</Text></View>;
  return createElement(NativeSearch, { ref: nativeRef, appearance: theme, placeholder, disabled: control.disabled, controlled: value.controlled, eventCount: value.eventCount, defaultText: value.defaultText, text: value.text, onChangeText: changed, style: props.style, testID: props.testID, accessibilityLabel: props.accessibilityLabel });
}
