import { createRequire } from "node:module";
import React, { act, useImperativeHandle, useRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const { create } = createRequire(import.meta.url)("react-test-renderer");
const { registerShortcut } = vi.hoisted(() => ({ registerShortcut: vi.fn() }));
vi.mock("@legendapp/spark-desktop-shortcuts", () => ({ registerShortcut }));
vi.mock("../packages/rich-text/src/useInputShortcuts", async () => import("../packages/rich-text/src/useInputShortcuts.macos"));

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  StyleSheet: { absoluteFill: {}, flatten: (styles: any): any => Array.isArray(styles) ? Object.assign({}, ...styles.map((style: any) => style || {})) : styles, create: (styles: unknown) => styles },
}));
vi.mock("react-native-enriched-html", () => ({
  EnrichedText: "HtmlPreview",
  EnrichedTextInput: NativeInput,
}));
vi.mock("react-native-enriched-markdown", () => ({
  EnrichedMarkdownText: "MarkdownPreview",
  EnrichedMarkdownTextInput: NativeInput,
}));
import { EditableMarkdown, Markdown, MarkdownInput } from "../packages/desktop/markdown";

import { EditableHtml, Html, HtmlInput } from "../packages/desktop/html";

const instances: Array<{
  selection: number;
  value: string;
  setValue: ReturnType<typeof vi.fn>;
  blur: ReturnType<typeof vi.fn>;
  toggleBold: ReturnType<typeof vi.fn>;
  setLink: ReturnType<typeof vi.fn>;
}> = [];
function NativeInput(props: any) {
  const instance = useRef<any>(null);
  if (!instance.current) {
    instance.current = {
      selection: 0,
      value: props.defaultValue,
      setValue: vi.fn((value: string) => {
        instance.current.value = value;
        instance.current.selection = 0;
      }),
      toggleBold: vi.fn(),
      setLink: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(() => props.onBlur?.()),
    };
    instances.push(instance.current);
  }
  useImperativeHandle(props.ref, () => instance.current, []);
  return React.createElement("NativeInput", props);
}
let rendered: any;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  instances.length = 0;
  registerShortcut.mockReset();
  registerShortcut.mockImplementation(async () => ({ remove: vi.fn(async () => {}) }));
  const error = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (!String(args[0]).startsWith("react-test-renderer is deprecated")) error(...args);
  });
});

afterEach(async () => {
  if (rendered)
    await act(async () => {
      rendered.unmount();
    });
  rendered = undefined;
  vi.restoreAllMocks();
});

for (const { name, Input, Editable, preview, source, change } of [
  {
    name: "Markdown", Input: MarkdownInput, Editable: EditableMarkdown, preview: "MarkdownPreview",
    source: "**👩🏽‍💻 café**",
    change: (props: any, value: string) => props.onChangeMarkdown(value),
  },
  {
    name: "HTML", Input: HtmlInput, Editable: EditableHtml, preview: "HtmlPreview",
    source: "<p><strong>👩🏽‍💻 café</strong></p>",
    change: (props: any, value: string) => props.onChangeHtml({ nativeEvent: { value } }),
  },
]) {
  test(`${name} click-to-edit preserves the native caret across focus and Escape`, async () => {
    const props = { value: source, onChangeText: vi.fn() };
    await act(async () => {
      rendered = create(React.createElement(Editable, props));
    });
    if (name === "HTML") expect(rendered.root.findByType(preview).props.children).toBe(source);
    const original = instances[0];
    original.selection = "👩🏽‍💻 ".length;
    await act(async () => {
      rendered.root.findByType("NativeInput").props.onFocus();
    });
    expect(rendered.root.findAllByType(preview)).toHaveLength(0);
    expect(instances).toHaveLength(1);
    expect(original.selection).toBe("👩🏽‍💻 ".length);
    await act(async () => {
      rendered.root.findByType("NativeInput").props.onKeyPress({ nativeEvent: { key: "Escape" } });
    });
    expect(original.blur).toHaveBeenCalledOnce();
    expect(rendered.root.findAllByType(preview)).toHaveLength(1);
    expect(instances).toHaveLength(1);
    expect(original.setValue).not.toHaveBeenCalled();
  });

  test(`${name} accepted edits preserve selection, external updates replace value, rejected edits revert`, async () => {
    let value = "first";
    const onChangeText = vi.fn((next: string) => {
      value = next;
      rendered.update(React.createElement(Input, { value, onChangeText }));
    });
    await act(async () => {
      rendered = create(React.createElement(Input, { value, onChangeText }));
    });
    const instance = instances[0];
    instance.selection = 4;
    await act(async () => {
      change(rendered.root.findByType("NativeInput").props, "**first**\n");
    });
    expect(onChangeText).toHaveBeenCalledWith("**first**\n");
    expect(instance.setValue).not.toHaveBeenCalled();
    expect(instance.selection).toBe(4);
    if (name === "HTML") expect(rendered.root.findByType("NativeInput").props.defaultValue).toBe("first");
    await act(async () => {
      rendered.update(React.createElement(Input, { value: "external", onChangeText: () => {} }));
    });
    expect(instance.setValue).toHaveBeenLastCalledWith("external");
    await act(async () => {
      change(rendered.root.findByType("NativeInput").props, "rejected");
    });
    expect(instance.setValue).toHaveBeenLastCalledWith("external");
    expect(instances).toHaveLength(1);
  });
}

test("HTML native formatting shortcuts follow focus and link commands use UTF-16 selection", async () => {
  const remove = vi.fn(async () => {});
  registerShortcut.mockImplementation(async () => ({ remove }));
  await act(async () => {
    rendered = create(React.createElement(HtmlInput, {
      value: "<p>👩🏽‍💻 café</p>", onChangeText: vi.fn(), formatting: true,
      onRequestLink: () => "https://example.com",
    }));
  });
  expect(registerShortcut).not.toHaveBeenCalled();
  await act(async () => {
    rendered.root.findByType("NativeInput").props.onFocus();
  });
  expect(registerShortcut.mock.calls.map(([key]) => key)).toEqual([
    "Escape", "Cmd+B", "Cmd+I", "Cmd+Shift+7", "Cmd+Shift+8", "Cmd+K",
  ]);
  const bold = registerShortcut.mock.calls.find(([key]) => key === "Cmd+B")![1];
  await act(async () => { bold(); });
  expect(instances[0].toggleBold).toHaveBeenCalledOnce();
  const start = "👩🏽‍💻 ".length, end = start + "café".length;
  rendered.root.findByType("NativeInput").props.onChangeSelection({ nativeEvent: { start, end, text: "café" } });
  const link = registerShortcut.mock.calls.find(([key]) => key === "Cmd+K")![1];
  await act(async () => { link(); });
  expect(instances[0].setLink).toHaveBeenCalledWith(start, end, "café", "https://example.com");
  await act(async () => { rendered.root.findByType("NativeInput").props.onBlur(); });
  expect(remove).toHaveBeenCalledTimes(6);
  bold();
  expect(instances[0].toggleBold).toHaveBeenCalledOnce();
});

for (const { Reader, preview, contentProp, blockStyle } of [
  { Reader: Markdown, preview: "MarkdownPreview", contentProp: "markdown", blockStyle: "markdownStyle" },
  { Reader: Html, preview: "HtmlPreview", contentProp: "children", blockStyle: "htmlStyle" },
]) {
  test(`${preview} renders strings, updates content, and forwards style and link events`, async () => {
    const onLinkPress = vi.fn();
    const style = [{ fontSize: 18 }, false as const, { color: "navy" }];
    const format = { h1: { fontSize: 28 } };
    const props = { style, onLinkPress, testID: "reader", accessibilityLabel: "Article", [blockStyle]: format };
    await act(async () => {
      rendered = create(React.createElement(Reader, props, "First **article**"));
    });
    let native = rendered.root.findByType(preview);
    expect(native.props[contentProp]).toBe("First **article**");
    expect(native.props[preview === "MarkdownPreview" ? "containerStyle" : "style"]).toEqual({ fontSize: 18, color: "navy" });
    expect(native.props[blockStyle]).toBe(format);
    expect(native.props.selectable).toBe(true);
    expect(native.props.testID).toBe("reader");
    expect(native.props.accessibilityLabel).toBe("Article");
    native.props.onLinkPress({ url: "https://legendapp.com" });
    expect(onLinkPress).toHaveBeenCalledWith({ url: "https://legendapp.com" });
    expect(instances).toHaveLength(0);
    expect(registerShortcut).not.toHaveBeenCalled();
    if (Reader === Markdown) expect(native.props.enableTaskListItemToggle).toBe(false);
    for (const value of ["Updated article", ""]) {
      await act(async () => {
        rendered.update(React.createElement(Reader, { ...props, value, selectable: false }, "Ignored children"));
      });
      native = rendered.root.findByType(preview);
      expect(native.props[contentProp]).toBe(value);
      expect(native.props.selectable).toBe(false);
    }
    await act(async () => { rendered.update(React.createElement(Reader)); });
    expect(rendered.root.findByType(preview).props[contentProp]).toBe("");
  });
}
