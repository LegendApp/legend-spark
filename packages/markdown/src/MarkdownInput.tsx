import { useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
  type MarkdownStyle,
} from "react-native-enriched-markdown";
import {
  FormattingButtons,
  InputPreview,
  useInputValue,
  useInputShortcuts,
  type FormattingAction,
  type RichTextInputProps,
  type RichTextInputRef,
} from "@legendapp/spark-rich-text";

import { Markdown } from "./Markdown";

export interface MarkdownInputProps extends RichTextInputProps {
  markdownStyle?: MarkdownStyle;
}
export type MarkdownInputRef = RichTextInputRef;

export function MarkdownInput(props: MarkdownInputProps) {
  return <MarkdownEditor {...props} />;
}

export function EditableMarkdown(props: MarkdownInputProps) {
  return <MarkdownEditor {...props} preview />;
}

function MarkdownEditor({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  onFocus,
  onBlur,
  style,
  markdownStyle,
  ref,
  formatting,
  onRequestLink,
  accessibilityLabel,
  testID,
  preview = false,
}: MarkdownInputProps & { preview?: boolean }) {
  const input = useRef<EnrichedMarkdownTextInputInstance | null>(null);
  const [editing, setEditing] = useState(false);
  const format = (action: FormattingAction) => {
    const url = action === "link" ? onRequestLink?.() : undefined;
    input.current?.focus();
    if (action === "link") {
      if (url) input.current?.setLink(url);
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
        {/* Slides' NotesText keeps this native view alive so a click never needs a source-offset estimate. */}
        <EnrichedMarkdownTextInput
          ref={input}
          defaultValue={value}
          multiline
          scrollEnabled={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          markdownStyle={markdownStyle}
          style={inputStyle}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          onChangeMarkdown={change}
          onFocus={() => {
            setEditing(true);
            onFocus?.();
          }}
          onBlur={() => {
            setEditing(false);
            onBlur?.();
          }}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Escape") input.current?.blur();
          }}
        />
        {preview && (
          <InputPreview editing={editing} style={style}>
            {value ? (
              <Markdown
                value={value}
                markdownStyle={markdownStyle}
                style={inputStyle}
                selectable={false}
              />
            ) : (
              <Text style={[inputStyle, { color: "#888" }]}>{placeholder}</Text>
            )}
          </InputPreview>
        )}
      </View>
    </View>
  );
}
