# Rich text

`@legendapp/spark/markdown` exports `Markdown`, `MarkdownInput`, and `EditableMarkdown`.
`@legendapp/spark/html` exports `Html`, `HtmlInput`, and `EditableHtml`. The implementation
packages are bundled into Spark, following the other feature packages. Spark
supplies both native backends; importing another Spark feature does not load
their JavaScript or retain their native modules in production.

## Read-only rendering

`Markdown` and `Html` render through the same Enriched native text views as the
editable previews. Pass a string through `value` or `children`; `value` takes
precedence, including an empty string. With neither, the reader is empty.
Both accept React Native `style` (including arrays), view accessibility/test
props, `selectable` (default `true`), and `onLinkPress({ url })`. The handler
owns link navigation; the demo displays the URL without opening a browser.

```tsx
import { Markdown } from "@legendapp/spark/markdown";
import { Html } from "@legendapp/spark/html";

<Markdown value={"# Hello\n\nRead **Spark** and [Legend](https://legendapp.com)."} />;
<Html onLinkPress={({ url }) => console.log(url)}>
  {'<h1>Hello</h1><p>Read <strong>Spark</strong>.</p>'}
</Html>;
```

`Markdown` accepts the upstream `markdownStyle` for text and block formatting;
`style` styles its container. It supports headings, lists, links, code, and
images, with task checkboxes kept read-only. `Html` accepts the upstream
`htmlStyle`; supported elements and styling depend on the host backend. On
macOS it renders headings, lists, links, and code, but images are placeholders
rather than loaded images, and custom `htmlStyle` is not applied. Syntax
highlighting and math depend on the application's Enriched build settings.

## Inputs

All four inputs accept `value`, `onChangeText`, `placeholder`, `autoFocus`, `onFocus`,
`onBlur`, `style`, `accessibilityLabel`, and `testID`. The value is a Markdown or
HTML string, including its whitespace. A ref provides `focus()` and `blur()`.
`formatting` adds Bold, Italic, Link, Bullets, and Numbers buttons. Supply
`onRequestLink={() => url}` to enable Link. On macOS, `formatting` also enables
Cmd-B, Cmd-I, Cmd-K, Cmd-Shift-7, and Cmd-Shift-8 for those actions. `MarkdownInput` and `EditableMarkdown`
also accept the upstream `markdownStyle` type.

```tsx
import { EditableMarkdown } from "@legendapp/spark/markdown";

const [value, setValue] = useState("Hello **Spark**");
<EditableMarkdown value={value} onChangeText={setValue} placeholder="Write a note" />;
```

The editable variants show rendered content when unfocused. Click to edit;
blur or Escape finishes editing. Changes are delivered while typing; blur does
not request an asynchronous serialization from a native view being removed.
An accepted value echo leaves selection and native undo alone. An external
replacement or rejected edit sets the controlled value and may reset selection.
Upstream editors serialize supported formatting; arbitrary Markdown/HTML source
is not guaranteed to retain its original spelling after an edit.

## Installation

Spark installs `react-native-enriched-markdown@1.1.1` and
`react-native-enriched-html@1.1.1` and applies their compatibility patches
automatically during installation and native preparation. No separate
installation or package-manager patch configuration is needed. Native preparation
also repairs reinstalls when install scripts were disabled.

The workspace and kitchen sink disable math and syntax highlighting to avoid
downloading and compiling their heavy assets. These flags remain per application:

```json
{
  "enriched-markdown": {
    "enableCodeHighlight": false,
    "enableMath": false
  }
}
```

HTML uses Enriched HTML on iOS, Android, web, and macOS. The checked-in
macOS patch adds AppKit text views to the backend package. `HtmlInput` and
`EditableHtml` use the same native components on macOS as on mobile, without
an application WebView dependency or a separate editor adapter.
The macOS backend supports basic inline formatting, paragraphs/headings, links,
and lists. Editing flattens nested list structure. Remote image URLs round-trip
without loading their images. Reader/editor layout parity with custom line
heights still needs native acceptance.
Windows is unsupported; the kitchen sink uses a separate explanatory screen.

## Caret and reused Slides code

The implementation adapts `apps/slides/src/EditableMarkdown.tsx`'s `NotesText`:
retain the native text view across focus, use native click hit testing, and
suppress native `setValue` for value echoes. It omits Slides' autosave, note-step
markers, conflict handling, and document/list infrastructure. The supplied patch
also retains Slides/Markdown Document's native text-selection and keyboard fixes.

The reader overlays a mounted input without taking pointer events. Clicking
therefore reaches that input's text engine directly; focus removes the reader
without replacing the input or assigning a guessed Markdown-source offset.
UTF-16 caret positions remain native plain-text positions, including styled
text and emoji. AppKit owns HTML click-to-caret placement and selection
ranges across focus changes on macOS.
The large `presentation`, `markdown-document`, `markdown-block-editor`, and
`native-text-source` packages are not dependencies of these small inputs.

Reader/editor layout parity, especially custom Markdown block styles, still
needs visual native acceptance. Use an opaque `style.backgroundColor` for the
native reader overlay; it defaults to white.

## Example and validation

`examples/kitchen-sink/RichText.tsx` shows both readers with headings, lists,
links, code, and a Markdown image, plus all four controlled inputs and formatting
buttons. `tests/rich-text-values.test.ts` checks value synchronization.
`tests/native-dependency-patches.test.ts` checks backend installation, repair,
and pruning; `tests/package-distribution.test.ts` checks archive patch delivery.
`tests/rich-text-shortcuts.test.ts` checks focused shortcut lifetime and callbacks.
`tests/rich-text-components.test.ts` checks caret retention through focus/Escape
and accepted, external, and rejected values with mocked native text components. These tests do not prove native hit testing.

Click hit testing, reader/editor layout parity, and formatting on supported
hosts still need native acceptance. The portable tests use mocked native
components; they do not establish native acceptance.
