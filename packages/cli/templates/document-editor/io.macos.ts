import { io as desktop } from "./io.desktop";
import { showMessage } from "@legendapp/spark/dialogs";
import type { DocumentIO } from "./document";
export const io: DocumentIO = { ...desktop, async confirmDiscard(name) {
  const { buttonId } = await showMessage({ title: "Unsaved changes", message: `Save changes to ${name}?`, buttons: [{ id: "cancel", label: "Cancel" }, { id: "discard", label: "Discard" }, { id: "save", label: "Save" }], cancelButtonId: "cancel", defaultButtonId: "save" });
  return buttonId === "save" ? "save" : buttonId === "discard" ? "discard" : "cancel";
} };
