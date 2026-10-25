import { useCallback, useState } from "react";
import {
  confirm, getFileDialogAvailability, getMessageDialogAvailability, openFileDialog, saveFileDialog, showAboutPanel, showMessage, showPrompt,
  type DialogAccessoryControl,
} from "@legendapp/spark/dialogs";
import { SparkError } from "@legendapp/spark/contracts";
import type { DialogMessages } from "./dialog-messages";

export type DemoId = "open" | "save" | "trash" | "confirm" | "rename" | "unlock" | "about" | "about-overrides";

/** Availability readouts, as JSON, keyed by the testID suffix that shows them. */
export function dialogAvailability() {
  return {
    files: getFileDialogAvailability(), accessory: getFileDialogAvailability("accessory"),
    messages: getMessageDialogAvailability(), checkbox: getMessageDialogAvailability("checkbox"),
    prompt: getMessageDialogAvailability("prompt"), "about-panel": getMessageDialogAvailability("aboutPanel"),
  };
}

function saveAccessory(t: DialogMessages): DialogAccessoryControl[] {
  return [
    { type: "popup", id: "dialogs-panels-save-format", label: t.format, options: (["txt", "md", "json"] as const).map(value => ({ value, label: t.formats[value] })), value: "md" },
    { type: "checkbox", id: "dialogs-panels-save-metadata", label: t.metadata, checked: true },
  ];
}

/**
 * "Don't ask again", the recommended pattern: skip the dialog while suppressed, and record the
 * checkbox only when the user confirmed, so Cancel never suppresses. This demo keeps the choice in
 * memory; an app persists it (for example in a settings store) and offers a way to reset it.
 */
export async function emptyTrash(t: DialogMessages, suppressed: boolean) {
  if (suppressed) return { emptied: true, asked: false, suppress: true };
  const result = await showMessage({
    title: t.trashTitle, message: t.trashMessage, kind: "warning",
    buttons: [{ id: "cancel", label: t.cancel }, { id: "empty", label: t.trashConfirm }], defaultButtonId: "empty", cancelButtonId: "cancel",
    checkbox: { label: t.dontAskAgain },
  });
  return { ...result, emptied: result.buttonId === "empty", asked: true, suppress: result.buttonId === "empty" && result.checked === true };
}

const DEMOS: Record<Exclude<DemoId, "trash">, (t: DialogMessages) => Promise<unknown>> = {
  open: t => openFileDialog({ accessory: [{ type: "checkbox", id: "dialogs-panels-open-read-only", label: t.readOnly }] }),
  save: t => saveFileDialog({ defaultName: "Notes", accessory: saveAccessory(t) }),
  confirm: t => confirm(t.confirmMessage, { title: t.confirmTitle, confirmLabel: t.confirmContinue, cancelLabel: t.cancel }),
  rename: t => showPrompt({ title: t.renameTitle, message: t.renameMessage, placeholder: t.renamePlaceholder, defaultValue: t.renameDefault, confirmLabel: t.renameConfirm, cancelLabel: t.cancel }),
  // A secure value is reported by length only.
  unlock: async t => {
    const result = await showPrompt({ title: t.unlockTitle, message: t.unlockMessage, placeholder: t.unlockPlaceholder, secure: true, confirmLabel: t.unlockConfirm, cancelLabel: t.cancel });
    return result.canceled ? result : { canceled: false, length: result.value.length };
  },
  about: () => showAboutPanel(),
  "about-overrides": t => showAboutPanel({ name: t.aboutName, version: "1.2.3", build: "456", credits: t.aboutCredits, copyright: t.aboutCopyright }),
};

const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : JSON.stringify(value ?? null);

/** Runs each demo and keeps its last result (JSON or SparkError:<code>) for the screen and flows. */
export function useDialogDemos(t: DialogMessages) {
  const [results, setResults] = useState<Partial<Record<DemoId, string>>>({});
  const [suppressed, setSuppressed] = useState(false);
  const run = useCallback(async (id: DemoId) => {
    try {
      if (id === "trash") {
        const result = await emptyTrash(t, suppressed);
        if (result.suppress) setSuppressed(true);
        setResults(current => ({ ...current, trash: describe(result) }));
        return;
      }
      const result = await DEMOS[id](t);
      setResults(current => ({ ...current, [id]: describe(result) }));
    } catch (error) {
      setResults(current => ({ ...current, [id]: describe(error) }));
    }
  }, [t, suppressed]);
  return { results, suppressed, run, askAgain: () => setSuppressed(false) };
}
