import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

export function InputPreview({
  editing,
  style,
  children,
}: {
  editing: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}) {
  const backgroundColor = StyleSheet.flatten(style)?.backgroundColor ?? "white";
  return (
    !editing && (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, { backgroundColor }]}
      >
        {children}
      </View>
    )
  );
}

export function FormattingButtons({
  onFormat,
  linkEnabled,
}: {
  onFormat(action: "bold" | "italic" | "link" | "unorderedList" | "orderedList"): void;
  linkEnabled: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 6 }}>
      {(["bold", "italic", "link", "unorderedList", "orderedList"] as const).map((action) => (
        <Pressable
          key={action}
          accessibilityRole="button"
          accessibilityLabel={action}
          disabled={action === "link" && !linkEnabled}
          onPress={() => onFormat(action)}
        >
          <Text style={{ color: action === "link" && !linkEnabled ? "#888" : "#2463eb" }}>
            {{ bold: "Bold", italic: "Italic", link: "Link", unorderedList: "Bullets", orderedList: "Numbers" }[action]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
