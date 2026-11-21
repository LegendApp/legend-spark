import type { Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
/** A layout-only ref; backend objects and native control methods stay internal. */
export interface ControlRef { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void }
export interface ControlProps {
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<ControlRef>;
  onError?: (error: SparkError) => void;
}
/**
 * A native text button. Without a width or height style it takes its intrinsic size on desktop.
 * `disclosure` is the macOS disclosure button (a chevron); it requires `expanded`, and its text names it for accessibility.
 */
export interface ButtonProps extends ControlProps {
  children: string;
  onPress?: () => void;
  variant?: "default" | "bordered" | "borderless" | "disclosure";
  /** Controlled expansion of a `disclosure` button; toggle it in `onPress`. Only valid with that variant. */
  expanded?: boolean;
  /** macOS SF Symbol shown before the title (not with `disclosure`). A name missing on this system reports `E_NOT_FOUND`; other platforms report `E_UNSUPPORTED_PLATFORM`. */
  symbol?: string;
  /** AppKit control size; `regular` (default) everywhere, `small` and `mini` on macOS and web. */
  size?: "regular" | "small" | "mini";
}
/** A controlled on/off switch. */
export interface SwitchProps extends ControlProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityHint?: string;
}
/** A controlled native checkbox. `children` is its label; without one, set `accessibilityLabel`. */
export interface CheckboxProps extends ControlProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  children?: string;
}
interface TextInputCommonProps extends ControlProps {
  /** Shown while the input is empty. */
  placeholder?: string;
  /** Several lines that wrap and scroll (an NSTextView on macOS, a `textarea` on web); Return inserts a newline. Defaults to one line. */
  multiline?: boolean;
}
export interface ControlledTextInputProps extends TextInputCommonProps {
  value: string;
  defaultValue?: never;
  onChangeText?: (text: string) => void;
}
export interface UncontrolledTextInputProps extends TextInputCommonProps {
  value?: never;
  /** Read only on mount. Remount to reset an uncontrolled input. */
  defaultValue?: string;
  onChangeText?: (text: string) => void;
}
export type TextInputProps = ControlledTextInputProps | UncontrolledTextInputProps;
export interface SelectOption { label: string; value: string }
interface ChoiceControlProps extends ControlProps {
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}
export interface SelectProps extends ChoiceControlProps {
  accessibilityHint?: string;
  /** Borderless popup on macOS and web. Other platforms report `E_UNSUPPORTED_PLATFORM`. */
  variant?: "default" | "borderless";
}
export interface SegmentedControlProps extends ChoiceControlProps {
  accessibilityHint?: string;
  /** `small` is the compact control size. Defaults to `regular`. */
  size?: "regular" | "small";
  /** `fit` sizes segments to their labels; `fill` shares the control's width equally. Defaults to `fit`. */
  distribution?: "fit" | "fill";
}
/** A controlled group of native radio buttons: one per option, with `value` selected. */
export interface RadioGroupProps extends ChoiceControlProps {
  /** `vertical` (default) stacks the buttons; `horizontal` puts them on one line. */
  orientation?: "vertical" | "horizontal";
  /** AppKit control size: `regular` (default), `small` or `mini`. */
  size?: "regular" | "small" | "mini";
}
export type ControlKind = "button" | "text-input" | "select" | "segmented-control" | "checkbox" | "radio-group" | "switch";
