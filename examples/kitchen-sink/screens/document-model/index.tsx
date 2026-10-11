import { defineScreens } from "../../shell/registry";
import { Documents } from "./Documents";

export default defineScreens("document-model", [
  { id: "documents", title: "Documents", summary: "A document session on a temp file: untitled numbering, edited dot, Save/Save As with conflict checks, autosave in place, Duplicate, Rename, Move To, Revert, NSFileVersion versions and locking.", component: Documents },
]);
