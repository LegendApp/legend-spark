import { selectionIndex } from "./select";
import type { CSSProperties } from "react";
import { View } from "react-native";
import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { controlKinds, unsupportedPlatform, useControl, useTextValue, validateButton, validateCheckbox, validateRadioGroup, validateSegmented } from "./control";
import type { ButtonProps, CheckboxProps, RadioGroupProps, TextInputProps, SelectProps, SegmentedControlProps, ControlKind } from "./types";
export type { ButtonProps, CheckboxProps, RadioGroupProps, TextInputProps, ControlledTextInputProps, UncontrolledTextInputProps, SelectProps, SelectOption, SegmentedControlProps, ControlProps, ControlRef, ControlKind } from "./types";
export function getControlAvailability(control: ControlKind): Availability {
  if (!controlKinds.includes(control)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown control kind");
  return { available: true };
}
const nativeStyle: CSSProperties = { width: "100%", height: "100%", boxSizing: "border-box", font: "14px system-ui" };
const borderlessStyle: CSSProperties = { ...nativeStyle, border: "none", background: "transparent" };
export function Button(props: ButtonProps) {
  validateButton(props); const control = useControl(props, props.symbol !== undefined ? unsupportedPlatform : undefined);
  const { children, onPress, variant = "default", expanded, size = "regular", accessibilityLabel = children, style, testID } = props;
  const font = size === "regular" ? nativeStyle.font : size === "small" ? "12px system-ui" : "10px system-ui";
  return <View ref={control.ref} style={[{ width: 160, height: 36 }, style]} testID={testID}>
    <button type="button" disabled={control.disabled || control.failed} onClick={() => { if (control.active()) onPress?.(); }} aria-label={accessibilityLabel} aria-expanded={expanded}
      style={{ ...(variant === "borderless" ? borderlessStyle : nativeStyle), font }}>{variant === "disclosure" ? (expanded ? "\u25B4" : "\u25BE") : children}</button>
  </View>;
}
export function Checkbox(props: CheckboxProps) {
  validateCheckbox(props); const control = useControl(props);
  return <View ref={control.ref} style={props.style} testID={props.testID}>
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "14px system-ui" }}>
      <input type="checkbox" checked={props.value} disabled={control.disabled} aria-label={props.accessibilityLabel} onChange={() => { if (control.active()) props.onValueChange(!props.value); }} />{props.children}
    </label>
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
  validateSegmented(props);
  const control = useSelection(props), fill = props.distribution === "fill", font = props.size === "small" ? "12px system-ui" : nativeStyle.font;
  return <View ref={control.ref} style={[{ width: 240, height: 36 }, props.style]} testID={props.testID}>
    <div role="group" aria-label={props.accessibilityLabel} style={{ display: "flex", width: "100%", height: "100%" }}>
      {props.options.map(option => <button type="button" key={option.value} disabled={control.disabled} aria-pressed={option.value === props.value} onClick={() => control.change(option.value)} style={{ ...nativeStyle, font, flex: fill ? 1 : "0 0 auto", width: fill ? "100%" : "auto" }}>{option.label}</button>)}
    </div>
  </View>;
}
export function RadioGroup(props: RadioGroupProps) {
  validateRadioGroup(props);
  const control = useSelection(props), font = props.size === "small" ? "12px system-ui" : props.size === "mini" ? "10px system-ui" : nativeStyle.font;
  return <View ref={control.ref} style={props.style} testID={props.testID}>
    <div role="radiogroup" aria-label={props.accessibilityLabel} style={{ display: "flex", flexDirection: props.orientation === "horizontal" ? "row" : "column", gap: props.orientation === "horizontal" ? 16 : 6, font }}>
      {props.options.map(option => <label key={option.value} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <input type="radio" checked={option.value === props.value} disabled={control.disabled} onChange={() => control.change(option.value)} />{option.label}
      </label>)}
    </div>
  </View>;
}
