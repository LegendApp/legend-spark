import { openFileDialog, saveFileDialog } from "@legendapp/spark/dialogs";
import { readText, writeText, writeTextIfUnchanged } from "@legendapp/spark/files";
import { Alert } from "react-native";
import type { DocumentIO } from "./document";
export const io: DocumentIO = {
  async open() {
    const paths = await openFileDialog({ filters: [{ extensions: ["txt", "md", "json"] }], multiple: false });
    if (paths.canceled) return null;
    const location = paths.paths[0];
    return { file: { location, name: location.split(/[\\/]/).pop()! }, text: await readText(location) };
  },
  async save(file, text, expected, saveAs) {
    const result = saveAs || !file.location ? await saveFileDialog({ defaultName: file.name, filters: [{ extensions: ["txt", "md", "json"] }] }) : { canceled: false as const, path: file.location };
    if (result.canceled) return null;
    const location = result.path;
    if (!location) return null;
    if (location === file.location) {
      if (!(await writeTextIfUnchanged(location, expected, text)).written) throw new Error("The file changed outside the editor. Use Save As to keep your edits in another file.");
    } else await writeText(location, text);
    return { location, name: location.split(/[\\/]/).pop()! };
  },
  confirmDiscard: name => new Promise(resolve => Alert.alert("Unsaved changes", `Save changes to ${name}?`, [
    { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
    { text: "Discard", style: "destructive", onPress: () => resolve("discard") },
    { text: "Save", onPress: () => resolve("save") },
  ], { cancelable: false })),
};
