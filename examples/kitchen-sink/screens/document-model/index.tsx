import { defineScreens } from "../../shell/registry";
import { Documents } from "./Documents";
import { Printing } from "./Printing";

export default defineScreens("document-model", [
  { id: "documents", title: "Documents", summary: "A document session on a temp file: untitled numbering, edited dot, Save/Save As with conflict checks, autosave in place, Duplicate, Rename, Move To, Revert, NSFileVersion versions and locking.", component: Documents },
  { id: "printing", title: "Printing", summary: "Print a report, this window or one view with the print panel's live preview; page setup kept in app settings; headless PDF export.", component: Printing },
]);
