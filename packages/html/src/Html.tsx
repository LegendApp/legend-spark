import { StyleSheet, type StyleProp, type TextStyle, type ViewProps } from "react-native";
import { EnrichedText, type EnrichedTextHtmlStyle } from "react-native-enriched-html";

export interface HtmlProps extends Omit<ViewProps, "children" | "style"> {
  value?: string;
  children?: string;
  style?: StyleProp<TextStyle>;
  htmlStyle?: EnrichedTextHtmlStyle;
  selectable?: boolean;
  onLinkPress?(event: { url: string }): void;
}

export function Html({ value, children, style, selectable = true, ...props }: HtmlProps) {
  return (
    <EnrichedText
      {...props}
      children={value ?? children ?? ""}
      style={StyleSheet.flatten(style)}
      selectable={selectable}
    />
  );
}
