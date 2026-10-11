import { useState } from "react";
import { Platform, Text, View, type NativeSyntheticEvent } from "react-native";
import NativeTextInput from "./SparkTextInputNativeComponent";
import NativeButton from "./SparkButtonNativeComponent";
import NativeSelect from "./native-select/NativeSelectNativeComponent";
import WindowsSelect from "./SparkSelectNativeComponent";
import NativeSegmentedControl from "./native-select/NativeSegmentedControlNativeComponent";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { isEventCount, useControl, useTextValue, validateButton } from "./control";
import { getControlAvailability } from "./availability";
import { getButtonAvailability, requireAppKitButtonOptions } from "./button";
import { selectionIndex } from "./select";
import type { ButtonProps, TextInputProps, SelectProps, SegmentedControlProps } from "./types";
export type { ButtonProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export { getControlAvailability } from "./availability";
export { getButtonAvailability } from "./button";
export type { ButtonVariant, ButtonAvailabilityOptions } from "./types";

export function Button(props: ButtonProps) {
  validateButton(props);
  requireAppKitButtonOptions(props);
  const control = useControl(props, getButtonAvailability({ variant: props.variant, size: props.size }));
  const { children, size = "regular", onPress, accessibilityLabel = children, style, testID } = props;
  // Only an explicit `default` is the AppKit Return-key button; an omitted variant is a plain push button.
  const variant = props.variant ?? (Platform.OS === "macos" ? "push" : "default");
  const frame = { width: variant === "help" ? 36 : 160, height: { mini: 20, small: 26, regular: 36, large: 44 }[size] };
  if (control.failed) return <View ref={control.ref} style={[frame, style]} testID={testID} accessible accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }}><Text>{children}</Text></View>;
  return <NativeButton ref={control.ref} title={children} disabled={control.disabled} variant={variant} controlSize={size} accessibilityLabel={accessibilityLabel}
    onButtonPress={() => { if (control.active()) onPress?.(); }} onUnavailable={control.unavailable} testID={testID} style={[frame, style]} />;
}
export function TextInput(props: TextInputProps) {
  const control = useControl(props, getControlAvailability("text-input"));
  const value = useTextValue(props);
  function changed(event: NativeSyntheticEvent<{ text: string; eventCount: number }>) {
    if (!control.active()) return;
    const data = event?.nativeEvent;
    if (typeof data?.text !== "string" || !isEventCount(data.eventCount)) { control.error(new SparkError("E_INVALID_DATA", "Invalid native text change")); return; }
    if (value.acknowledge(data.eventCount)) props.onChangeText?.(data.text);
  }
  const { accessibilityLabel, style, testID } = props;
  if (control.failed) return <View ref={control.ref} style={[{ width: 240, height: 36 }, style]} testID={testID} accessible accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }}><Text>{value.controlled ? value.text : value.defaultText}</Text></View>;
  return <NativeTextInput ref={control.ref} text={value.text} defaultText={value.defaultText} controlled={value.controlled} eventCount={value.eventCount} disabled={control.disabled} onTextChange={changed} onUnavailable={control.unavailable} accessibilityLabel={accessibilityLabel} testID={testID} style={[{ width: 240, height: 36 }, style]} />;
}
function Selection({ segmented, ...props }: SelectProps & { segmented: boolean }) {
  selectionIndex(props.options, props.value);
  if (typeof props.onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onValueChange");
  const control = useControl(props, getControlAvailability(segmented ? "segmented-control" : "select"));
  const [selectionRevision, revise] = useState(0);
  const { options, value, onValueChange, accessibilityLabel, style, testID } = props;
  function changed(event: NativeSyntheticEvent<{ value: string }>) {
    if (!control.active()) return;
    const next = event?.nativeEvent?.value;
    if (!options.some(option => option.value === next)) { control.error(new SparkError("E_INVALID_DATA", "Native selection is not an option")); return; }
    revise(revision => revision + 1); onValueChange(next);
  }
  const common = { ref: control.ref, value, accessibilityLabel, testID, style: [{ width: 240, height: 36 }, style], selectionRevision };
  if (control.failed) return <View ref={control.ref} style={common.style} testID={testID} accessible accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true }}><Text>{options.find(option => option.value === value)!.label}</Text></View>;
  if (segmented) return <NativeSegmentedControl {...common} segmentsJson={JSON.stringify(options)} enabled={!control.disabled} onValueChange={changed} />;
  if (Platform.OS === "windows") return <WindowsSelect {...common} itemsJson={JSON.stringify(options)} disabled={control.disabled} onSelectionChange={changed} onUnavailable={control.unavailable} />;
  return <NativeSelect {...common} itemsJson={JSON.stringify(options)} enabled={!control.disabled} onValueChange={changed} />;
}
export function Select(props: SelectProps) { return <Selection {...props} segmented={false} />; }
export function SegmentedControl(props: SegmentedControlProps) { return <Selection {...props} segmented />; }

export * from "./primitives-controls";
