import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { registerShortcut, type AsyncRegistration } from "@legendapp/spark-desktop-shortcuts";
import type { RichTextInputRef, FormattingAction } from "./types";
import type { InputFormattingShortcuts } from "./useInputShortcuts";

// Native removal is asynchronous; a newly focused editor must await the old owner.
let pendingCleanup: Promise<void> = Promise.resolve();

export function useInputShortcuts(
  input: RefObject<RichTextInputRef | null>,
  focused: boolean,
  formatting?: InputFormattingShortcuts,
) {
  const onFormat = useRef(formatting?.onFormat);
  useLayoutEffect(() => {
    onFormat.current = formatting?.onFormat;
  }, [formatting?.onFormat]);
  const enabled = !!formatting,
    linkEnabled = !!formatting?.linkEnabled;
  useEffect(() => {
    if (!focused) return;
    let active = true;
    const shortcuts = new Set<AsyncRegistration>();
    const bindings: Array<[string, () => void]> = [["Escape", () => input.current?.blur()]];
    if (enabled) {
      const actions: Array<[string, FormattingAction]> = [
        ["Cmd+B", "bold"],
        ["Cmd+I", "italic"],
        ["Cmd+Shift+7", "orderedList"],
        ["Cmd+Shift+8", "unorderedList"],
      ];
      if (linkEnabled) actions.push(["Cmd+K", "link"]);
      for (const [key, action] of actions) bindings.push([key, () => onFormat.current?.(action)]);
    }
    const setup = pendingCleanup.then(async () => {
      if (!active) return;
      await Promise.all(bindings.map(async ([key, handler]) => {
        try {
          const registration = await registerShortcut(key, () => {
            if (active) handler();
          });
          shortcuts.add(registration);
        } catch (error) {
          console.error(error);
        }
      }));
    });
    return () => {
      active = false;
      pendingCleanup = setup.then(async () => {
        await Promise.all([...shortcuts].map((shortcut) => shortcut.remove().catch(console.error)));
      });
    };
  }, [input, focused, enabled, linkEnabled]);
}
