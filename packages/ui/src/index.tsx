import { useCallback } from "react";
import type { NativeSyntheticEvent } from "react-native";
import NativeTextInput from "./SparkTextInputNativeComponent";
import { NativeSelect } from "./native-select";
import { selectionIndex } from "./select";
import { StyleSheet } from "react-native";
import NativeButton from "./SparkButtonNativeComponent";
import type { ButtonProps, TextInputProps, SelectProps } from "./types";
export type { ButtonProps, TextInputProps, SelectProps } from "./types";

export function Button({ children, onPress, disabled = false, variant = "default", style, testID }: ButtonProps) {
  return <NativeButton title={children} disabled={disabled} variant={variant}
    onButtonPress={disabled ? undefined : onPress} testID={testID}
    style={[styles.button, style]} />;
}
const styles = StyleSheet.create({ button: { width: 160, height: 36 } });

export function TextInput({ defaultValue = "", onChangeText, style, ...props }: TextInputProps) {
  const changed = useCallback((event: NativeSyntheticEvent<{ text: string }>) => onChangeText?.(event.nativeEvent.text), [onChangeText]);
  return <NativeTextInput {...props} defaultText={defaultValue} onTextChange={changed} style={[{ width: 240, height: 36 }, style]} />;
}
export function Select({ options, value, onValueChange, style, ...props }: SelectProps) {
  selectionIndex(options, value);
  return <NativeSelect {...props} options={options} value={value} onChange={onValueChange} style={[{ width: 240, height: 36 }, style]} />;
}
