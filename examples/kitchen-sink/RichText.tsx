import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { EditableMarkdown, Markdown, MarkdownInput } from "@legendapp/spark/markdown";
import { EditableHtml, Html, HtmlInput } from "@legendapp/spark/html";

export function RichText() {
  const [markdown, setMarkdown] = useState(
    "Hello **Spark**. Try *italic* or a [link](https://legendapp.com).\n\n- A small input",
  );
  const [editableMarkdown, setEditableMarkdown] = useState(
    "Click **anywhere in this text** to edit it. Escape or click outside to finish.",
  );
  const [html, setHtml] = useState("<p>Hello <strong>Spark</strong>. Try <em>italic</em>.</p>");
  const [editableHtml, setEditableHtml] = useState("<p>Click <strong>anywhere in this text</strong> to edit it.</p>");
  const [pressedLink, setPressedLink] = useState("");
  const onLinkPress = ({ url }: { url: string }) => setPressedLink(url);
  const onRequestLink = () => "https://legendapp.com";
  return (
    <View style={{ gap: 12 }}>
      <Text>Read-only Markdown</Text>
      <Markdown
        value={markdownArticle}
        markdownStyle={readerMarkdownStyle}
        style={styles.input}
        onLinkPress={onLinkPress}
        accessibilityLabel="Read-only Markdown"
        testID="markdown-reader"
      />
      <Text>GitHub Flavored Markdown</Text>
      <Markdown
        value={githubMarkdownTable}
        flavor="github"
        style={styles.input}
        accessibilityLabel="GitHub Flavored Markdown"
        testID="markdown-github-reader"
      />
      <Text>Read-only HTML</Text>
      <Html
        style={styles.input}
        onLinkPress={onLinkPress}
        accessibilityLabel="Read-only HTML"
        testID="html-reader"
      >{htmlArticle}</Html>
      <Text accessibilityLiveRegion="polite">{pressedLink ? `Pressed link: ${pressedLink}` : "Press a reader link to show its URL."}</Text>
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

const readerMarkdownStyle = { image: { height: 64, resizeMode: "contain" as const } };

const markdownArticle = `# A native Markdown reader

Write **bold ideas**, add *emphasis*, and visit [Legend](https://legendapp.com).

- Headings, paragraphs, and links
- Read and select without editing

1. Start with a string
2. Render it with Spark

Inline \`code\` and a fenced example:

\`\`\`ts
const message = "Hello, Spark";
\`\`\`

![React Native logo](https://reactnative.dev/img/tiny_logo.png)
`;

const githubMarkdownTable = `| Reader | Tables |
| --- | --- |
| \`flavor="commonmark"\` | Plain text |
| \`flavor="github"\` | Rendered |
`;

const htmlArticle = `<h1>A native HTML reader</h1>
<p>Write <strong>bold ideas</strong>, add <em>emphasis</em>, and visit <a href="https://legendapp.com">Legend</a>.</p>
<ul><li>Headings, paragraphs, and links</li><li>Read and select without editing</li></ul>
<ol><li>Start with a string</li><li>Render it with Spark</li></ol>
<p>Inline <code>code</code> and a block example:</p>
<pre>const message = "Hello, Spark";</pre>`;
