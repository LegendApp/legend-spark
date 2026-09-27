import { selectionIndex } from "./select";
import type { CSSProperties } from "react";
import { View } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl, useTextValue, validateButton } from "./control";
import type { ButtonProps, TextInputProps, SelectProps, SegmentedControlProps, ControlKind } from "./types";
export type { ButtonProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export function getControlAvailability(control: ControlKind): Availability {
  if (!["button", "text-input", "select", "segmented-control"].includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  return { available: true };
}
const nativeStyle: CSSProperties = { width: "100%", height: "100%", boxSizing: "border-box", font: "14px system-ui" };
const borderlessStyle: CSSProperties = { ...nativeStyle, border: "none", background: "transparent" };
export function Button(props: ButtonProps) {
  validateButton(props); const control = useControl(props);
  const { children, onPress, variant = "default", accessibilityLabel = children, style, testID } = props;
  return <View ref={control.ref} style={[{ width: 160, height: 36 }, style]} testID={testID}>
    <button type="button" disabled={control.disabled} onClick={() => { if (control.active()) onPress?.(); }} aria-label={accessibilityLabel}
      style={variant === "borderless" ? borderlessStyle : nativeStyle}>{children}</button>
  </View>;
}
export function TextInput(props: TextInputProps) {
  const control = useControl(props), state = useTextValue(props);
  return <View ref={control.ref} style={[{ width: 240, height: 36 }, props.style]} testID={props.testID}>
    <input type="text" value={state.controlled ? state.text : undefined} defaultValue={state.controlled ? undefined : state.defaultText} disabled={control.disabled}
      onChange={event => { if (control.active()) props.onChangeText?.(event.currentTarget.value); }} aria-label={props.accessibilityLabel} style={nativeStyle} />
  </View>;
}
function useSelection(props: SelectProps) {
  selectionIndex(props.options, props.value);
  if (typeof props.onValueChange !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected onValueChange");
  const control = useControl(props);
  return { ...control, change(value: string) {
    if (!control.active()) return;
    if (!props.options.some(option => option.value === value)) { control.error(new SparkError("E_INVALID_DATA", "Invalid native selection")); return; }
    props.onValueChange(value);
  } };
}
export function Select(props: SelectProps) {
  const control = useSelection(props);
  return <View ref={control.ref} style={[{ width: 240, height: 36 }, props.style]} testID={props.testID}>
    <select value={props.value} disabled={control.disabled} onChange={event => control.change(event.currentTarget.value)} aria-label={props.accessibilityLabel} style={nativeStyle}>
      {props.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </View>;
}
export function SegmentedControl(props: SegmentedControlProps) {
  const control = useSelection(props);
  return <View ref={control.ref} style={[{ width: 240, height: 36 }, props.style]} testID={props.testID}>
    <div role="group" aria-label={props.accessibilityLabel} style={{ display: "flex", width: "100%", height: "100%" }}>
      {props.options.map(option => <button type="button" key={option.value} disabled={control.disabled} aria-pressed={option.value === props.value} onClick={() => control.change(option.value)} style={{ ...nativeStyle, flex: 1 }}>{option.label}</button>)}
    </div>
  </View>;
}
