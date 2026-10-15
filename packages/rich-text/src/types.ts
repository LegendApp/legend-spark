import type { Ref } from "react";
import type { StyleProp, TextStyle } from "react-native";

export interface RichTextInputRef {
  focus(): void;
  blur(): void;
}

export interface RichTextInputProps {
  value: string;
  onChangeText(value: string): void;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?(): void;
  onBlur?(): void;
  style?: StyleProp<TextStyle>;
  ref?: Ref<RichTextInputRef>;
  formatting?: boolean;
  onRequestLink?(): string | undefined;
  accessibilityLabel?: string;
  testID?: string;
}

export type FormattingAction = "bold" | "italic" | "link" | "unorderedList" | "orderedList";
