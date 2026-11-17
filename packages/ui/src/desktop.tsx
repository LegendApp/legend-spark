import { useState } from "react";
import { Platform, Text, View, type NativeSyntheticEvent } from "react-native";
import NativeTextInput from "./SparkTextInputNativeComponent";
import NativeButton from "./SparkButtonNativeComponent";
import NativeSelect from "./native-select/NativeSelectNativeComponent";
import WindowsSelect from "./SparkSelectNativeComponent";
import NativeSegmentedControl from "./native-select/NativeSegmentedControlNativeComponent";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { macosButton, unsupportedPlatform, useControl, useTextValue, validateButton, validateCheckbox, validateSegmented } from "./control";
import { getControlAvailability } from "./availability";
import { selectionIndex } from "./select";
import type { ButtonProps, CheckboxProps, TextInputProps, SelectProps, SegmentedControlProps } from "./types";
export type { ButtonProps, CheckboxProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export { getControlAvailability } from "./availability";

// AppKit buttons report their intrinsic size, which sizes the view unless a style sets width or height.
// WinUI buttons do not, so they keep a fixed default frame.
function useIntrinsicSize(control: ReturnType<typeof useControl>) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  function measured(event: NativeSyntheticEvent<{ width: number; height: number }>) {
    if (!control.mounted()) return;
    const { width, height } = event?.nativeEvent ?? {};
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) { control.error(new SparkError("E_INVALID_DATA", "Invalid native control size")); return; }
    setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
  }
  return { frame: Platform.OS === "windows" ? { width: 160, height: 36 } : size, measured };
}
export function Button(props: ButtonProps) {
  validateButton(props);
  const { children, variant = "default", expanded, symbol, size = "regular", onPress, accessibilityLabel = children, style, testID } = props;
  const disclosure = variant === "disclosure";
  const control = useControl(props, Platform.OS === "windows" && macosButton(props) ? unsupportedPlatform : getControlAvailability("button"));
  function symbolError(event: NativeSyntheticEvent<{ name: string; message: string }>) {
    if (!control.mounted()) return;
    if (typeof event?.nativeEvent?.name !== "string" || typeof event?.nativeEvent?.message !== "string") { control.error(new SparkError("E_INVALID_DATA", "Invalid symbol error")); return; }
    if (event.nativeEvent.name === symbol) control.error(new SparkError("E_NOT_FOUND", event.nativeEvent.message));
  }
  const intrinsic = useIntrinsicSize(control);
  const [revision, revise] = useState(0);
  if (control.failed) return <View ref={control.ref} style={[{ width: 160, height: 36 }, style]} testID={testID} accessible accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: true, expanded }}><Text>{children}</Text></View>;
  return <NativeButton ref={control.ref} title={children} disabled={control.disabled} variant={variant} checked={expanded ?? false} checkedRevision={revision} accessibilityLabel={accessibilityLabel} symbol={symbol ?? ""} controlSize={size} onSymbolError={symbolError}
    onButtonPress={() => { if (!control.active()) return; if (disclosure) revise(value => value + 1); onPress?.(); }} onIntrinsicSize={intrinsic.measured} onUnavailable={control.unavailable} testID={testID} style={[intrinsic.frame, style]} />;
}
export function Checkbox(props: CheckboxProps) {
  validateCheckbox(props);
  const control = useControl(props, getControlAvailability("checkbox"));
  const intrinsic = useIntrinsicSize(control);
  const [revision, revise] = useState(0);
  const { children = "", value, onValueChange, accessibilityLabel = children, style, testID } = props;
  if (control.failed) return <View ref={control.ref} style={style} testID={testID} accessible accessibilityRole="checkbox" accessibilityLabel={accessibilityLabel} accessibilityState={{ checked: value, disabled: true }}><Text>{children}</Text></View>;
  return <NativeButton ref={control.ref} title={children} disabled={control.disabled} variant="checkbox" checked={value} checkedRevision={revision} accessibilityLabel={accessibilityLabel}
    onButtonPress={() => { if (!control.active()) return; revise(count => count + 1); onValueChange(!value); }} onIntrinsicSize={intrinsic.measured} onUnavailable={control.unavailable} testID={testID} style={[intrinsic.frame, style]} />;
}
export function TextInput(props: TextInputProps) {
  const control = useControl(props, getControlAvailability("text-input"));
  const value = useTextValue(props);
  function changed(event: NativeSyntheticEvent<{ text: string; eventCount: number }>) {
    if (!control.active()) return;
    const data = event?.nativeEvent;
    if (typeof data?.text !== "string" || !Number.isSafeInteger(data.eventCount) || data.eventCount < 1 || data.eventCount > 2147483647) { control.error(new SparkError("E_INVALID_DATA", "Invalid native text change")); return; }
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
  if (segmented) return <NativeSegmentedControl {...common} segmentsJson={JSON.stringify(options)} enabled={!control.disabled} controlSize={(props as SegmentedControlProps).size ?? "regular"} distribution={(props as SegmentedControlProps).distribution ?? "fit"} onValueChange={changed} />;
  if (Platform.OS === "windows") return <WindowsSelect {...common} itemsJson={JSON.stringify(options)} disabled={control.disabled} onSelectionChange={changed} onUnavailable={control.unavailable} />;
  return <NativeSelect {...common} itemsJson={JSON.stringify(options)} enabled={!control.disabled} onValueChange={changed} />;
}
export function Select(props: SelectProps) { return <Selection {...props} segmented={false} />; }
export function SegmentedControl(props: SegmentedControlProps) { validateSegmented(props); return <Selection {...props} segmented />; }
