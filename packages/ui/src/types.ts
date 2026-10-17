import type { ControlSize } from "./primitives.types";
import type { Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/** A layout-only ref; backend objects and native control methods stay internal. */
export interface ControlRef { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void }
/**
 * Props shared by every Spark UI control. `onError` receives runtime failures such as an unavailable native view or a
 * malformed native event; default console.error.
 */
export interface ControlProps {
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<ControlRef>;
  onError?: (error: SparkError) => void;
}
/**
 * A `Button` style. `default`, `bordered` and `borderless` render on every platform; the others are AppKit styles that
 * require macOS. On macOS only an explicit `default` is the Return-key button.
 */
export type ButtonVariant = "default" | "bordered" | "borderless" | "push" | "bevel" | "toolbar" | "help" | "cancel" | "destructive";
/** A button's style and size, as `Button` and `getButtonAvailability` take them. An explicit `size` requires macOS. */
export interface ButtonAvailabilityOptions { variant?: ButtonVariant; size?: ControlSize }
/** A native text button. Layout styles affect its frame, not OS-managed chrome. */
export interface ButtonProps extends ControlProps, ButtonAvailabilityOptions {
  children: string;
  onPress?: () => void;
}
/** Props for a controlled `TextInput`: `value` is the text shown. */
export interface ControlledTextInputProps extends ControlProps {
  value: string;
  defaultValue?: never;
  onChangeText?: (text: string) => void;
}
/** Props for an uncontrolled `TextInput`, seeded by `defaultValue`. */
export interface UncontrolledTextInputProps extends ControlProps {
  value?: never;
  /** Read only on mount. Remount to reset an uncontrolled input. */
  defaultValue?: string;
  onChangeText?: (text: string) => void;
}
/** Props for `TextInput`, controlled or uncontrolled. Switching modes after mount throws E_INVALID_ARGUMENT. */
export type TextInputProps = ControlledTextInputProps | UncontrolledTextInputProps;
/** An option of `Select`, `SegmentedControl` or `RadioGroup`. Labels must be nonempty and values unique among the options. */
export interface SelectOption { label: string; value: string }
/** Props for `Select`. Selection is controlled: `value` must match an option. */
export interface SelectProps extends ControlProps {
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}
/** Props for `SegmentedControl`, the same as `Select`'s. */
export interface SegmentedControlProps extends SelectProps {}
/** A control name for `getControlAvailability`. */
export type ControlKind = "button" | "text-input" | "select" | "segmented-control" | import("./primitives.types").PrimitiveKind;
export type { ControlSize, PrimitiveKind, PrimitiveControlProps, NumericControlProps, CheckboxValue, CheckboxProps, RadioGroupProps, SwitchProps, DisclosureTriangleProps, SliderProps, StepperProps, LevelIndicatorProps, ComboBoxProps, TokenFieldProps, PathControlProps, ProgressProps, DatePickerProps, DatePickerMode, DatePickerVariant, DatePickerCalendar, ColorWellProps, ColorWellVariant } from "./primitives.types";
