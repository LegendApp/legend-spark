import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { EditableMarkdown, MarkdownInput } from "@legendapp/spark/markdown";
import { EditableHtml, HtmlInput } from "@legendapp/spark/html";

export function RichText() {
  const [markdown, setMarkdown] = useState(
    "Hello **Spark**. Try *italic* or a [link](https://legendapp.com).\n\n- A small input",
  );
  const [editableMarkdown, setEditableMarkdown] = useState(
    "Click **anywhere in this text** to edit it. Escape or click outside to finish.",
  );
  const [html, setHtml] = useState("<p>Hello <strong>Spark</strong>. Try <em>italic</em>.</p>");
  const [editableHtml, setEditableHtml] = useState("<p>Click <strong>anywhere in this text</strong> to edit it.</p>");
  const onRequestLink = () => "https://legendapp.com";
  return (
    <View style={{ gap: 12 }}>
      <Text>Markdown input</Text>
      <MarkdownInput
        value={markdown}
        onChangeText={setMarkdown}
        placeholder="Markdown"
        style={styles.input}
        formatting
        onRequestLink={onRequestLink}
        accessibilityLabel="Markdown input"
        testID="markdown-input"
      />
      <Text>Click to edit Markdown</Text>
      <EditableMarkdown
        value={editableMarkdown}
        onChangeText={setEditableMarkdown}
        placeholder="Click to write Markdown"
        style={styles.input}
        formatting
        onRequestLink={onRequestLink}
        accessibilityLabel="Editable Markdown"
        testID="editable-markdown"
      />
      <Text>HTML input</Text>
      <HtmlInput
        value={html}
        onChangeText={setHtml}
        placeholder="HTML"
        style={styles.input}
        formatting
        onRequestLink={onRequestLink}
        accessibilityLabel="HTML input"
        testID="html-input"
      />
      <Text>Click to edit HTML</Text>
      <EditableHtml
        value={editableHtml}
        onChangeText={setEditableHtml}
        placeholder="Click to write HTML"
        style={styles.input}
        formatting
        onRequestLink={onRequestLink}
        accessibilityLabel="Editable HTML"
        testID="editable-html"
      />
      <Text selectable>{editableMarkdown}</Text>
      <Text selectable>{editableHtml}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: "white", color: "#18181b", fontSize: 16, minHeight: 60 },
});
