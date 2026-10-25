import { StyleSheet, type StyleProp, type TextStyle, type ViewProps } from "react-native";
import { EnrichedMarkdownText, type EnrichedMarkdownTextProps, type MarkdownStyle } from "react-native-enriched-markdown";

export interface MarkdownProps extends Omit<ViewProps, "children" | "style"> {
  value?: string;
  children?: string;
  style?: StyleProp<TextStyle>;
  markdownStyle?: MarkdownStyle;
  flavor?: EnrichedMarkdownTextProps["flavor"];
  selectable?: boolean;
  onLinkPress?(event: { url: string }): void;
}

export function Markdown({ value, children, style, selectable = true, ...props }: MarkdownProps) {
  return (
    <EnrichedMarkdownText
      {...props}
      markdown={value ?? children ?? ""}
      containerStyle={StyleSheet.flatten(style)}
      selectable={selectable}
      allowTrailingMargin={false}
      enableTaskListItemToggle={false}
    />
  );
}
