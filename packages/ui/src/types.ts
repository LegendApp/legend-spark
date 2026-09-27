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
/** A native text button. Layout styles affect its frame, not OS-managed chrome. */
export interface ButtonProps extends ControlProps {
  children: string;
  onPress?: () => void;
  variant?: "default" | "bordered" | "borderless";
}
export interface ControlledTextInputProps extends ControlProps {
  value: string;
  defaultValue?: never;
  onChangeText?: (text: string) => void;
}
export interface UncontrolledTextInputProps extends ControlProps {
  value?: never;
  /** Read only on mount. Remount to reset an uncontrolled input. */
  defaultValue?: string;
  onChangeText?: (text: string) => void;
}
export type TextInputProps = ControlledTextInputProps | UncontrolledTextInputProps;
export interface SelectOption { label: string; value: string }
export interface SelectProps extends ControlProps {
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}
export interface SegmentedControlProps extends SelectProps {}
export type ControlKind = "button" | "text-input" | "select" | "segmented-control";
