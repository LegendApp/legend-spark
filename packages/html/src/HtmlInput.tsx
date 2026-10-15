import { useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, View, type NativeSyntheticEvent } from "react-native";
import { EnrichedText, EnrichedTextInput, type EnrichedTextInputInstance } from "react-native-enriched-html";
import {
  FormattingButtons,
  InputPreview,
  useInputValue,
  useInputShortcuts,
  type FormattingAction,
} from "@legendapp/spark-rich-text";
import type { HtmlInputProps } from "./types";

export function HtmlInput(props: HtmlInputProps) {
  return <HtmlEditor {...props} />;
}

export function EditableHtml(props: HtmlInputProps) {
  return <HtmlEditor {...props} preview />;
}

function HtmlEditor({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  onFocus,
  onBlur,
  style,
  ref,
  formatting,
  onRequestLink,
  accessibilityLabel,
  testID,
  preview = false,
}: HtmlInputProps & { preview?: boolean }) {
  const input = useRef<EnrichedTextInputInstance | null>(null);
  const initialValue = useRef(value).current;
  const selection = useRef({ start: 0, end: 0, text: "" });
  const [editing, setEditing] = useState(false);
  const format = (action: FormattingAction) => {
    const url = action === "link" ? onRequestLink?.() : undefined;
    input.current?.focus();
    if (action === "link") {
      if (url)
        input.current?.setLink(
          selection.current.start,
          selection.current.end,
          selection.current.text || url,
          url,
        );
    } else if (action === "bold") input.current?.toggleBold();
    else if (action === "italic") input.current?.toggleItalic();
    else if (action === "unorderedList") input.current?.toggleUnorderedList();
    else input.current?.toggleOrderedList();
  };
  useInputShortcuts(input, editing, formatting ? { onFormat: format, linkEnabled: !!onRequestLink } : undefined);
  const change = useInputValue(value, (next) => input.current?.setValue(next), onChangeText);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), blur: () => input.current?.blur() }), []);
  const inputStyle = StyleSheet.flatten([{ minHeight: 44, padding: 0, fontSize: 16 }, style]);
  return (
    <View>
      {formatting && <FormattingButtons linkEnabled={!!onRequestLink} onFormat={format} />}
      <View>
        <EnrichedTextInput
          ref={input}
          defaultValue={initialValue}
          scrollEnabled={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          style={inputStyle}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          onChangeHtml={(event: NativeSyntheticEvent<{ value: string }>) => change(event.nativeEvent.value)}
          onChangeSelection={(event: NativeSyntheticEvent<{ start: number; end: number; text: string }>) => {
            selection.current = event.nativeEvent;
          }}
          onFocus={() => {
            setEditing(true);
            onFocus?.();
          }}
          onBlur={() => {
            setEditing(false);
            onBlur?.();
          }}
          onKeyPress={(event: NativeSyntheticEvent<{ key: string }>) => {
            if (event.nativeEvent.key === "Escape") input.current?.blur();
          }}
        />
        {preview && (
          <InputPreview editing={editing} style={style}>
            {value ? (
              <EnrichedText style={inputStyle}>{value}</EnrichedText>
            ) : (
              <Text style={[inputStyle, { color: "#888" }]}>{placeholder}</Text>
            )}
          </InputPreview>
        )}
      </View>
    </View>
  );
}
