import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";

// Test IDs: component-library-markdown-display-rendered once the document lays out; -link-<n> counts link presses.
const ID = "component-library-markdown-display";
const document = `# Markdown display

Text with **bold**, *italic* and \`code\`.

- First item
- Second item

> A quote

[A link](https://legendapp.com)

| Column | Value |
| --- | --- |
| A | 1 |
`;

/** react-native-markdown-display: markdown-it parsed into React Native views and text. */
export function MarkdownDisplayDemo() {
  const [rendered, setRendered] = useState(false);
  const [links, setLinks] = useState(0);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <View onLayout={event => setRendered(event.nativeEvent.layout.height > 100)}>
      <Markdown onLinkPress={() => { setLinks(count => count + 1); return false; }}>{document}</Markdown>
    </View>
    <Text className="font-mono text-xs text-foreground" testID={rendered ? `${ID}-rendered` : undefined}>{`rendered ${rendered}`}</Text>
    <Text className="font-mono text-xs text-foreground" testID={`${ID}-link-${links}`}>{`link presses ${links}`}</Text>
  </ScrollView>;
}
