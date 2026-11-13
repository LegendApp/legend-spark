import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { getFileDialogAvailability } from "@legendapp/spark-file-dialog";
import { Button } from "../../Controls";

const ID = "dialogs-expo-document-picker";
export function ExpoDocumentPickerScreen() {
  const [status, setStatus] = useState("running");
  const [selection, setSelection] = useState("");
  useEffect(() => {
    const check = async () => {
      if (!getFileDialogAvailability().available || typeof DocumentPicker.getDocumentAsync !== "function") throw new Error("File dialog backend unavailable");
      const code = await DocumentPicker.getDocumentAsync({ type: "application/not-supported" }).then(() => "resolved", error => error.code);
      if (code !== "ERR_UNAVAILABLE") throw new Error(`Unsupported MIME filter: ${code}`);
    };
    void check().then(() => setStatus("passed"), error => setStatus(`failed: ${String(error)}`));
  }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${status === "passed" ? "passed" : status.startsWith("failed") ? "failed" : "running"}`}>{status}</Text>
    <Text className="text-sm text-muted">Original Expo import with native file dialogs. Common MIME types are supported; unknown filters reject explicitly. Picking and cancelling the open panel require a person.</Text>
    <Button testID={`${ID}-pick`} onPress={() => void DocumentPicker.getDocumentAsync({ multiple: true }).then(result => setSelection(JSON.stringify(result)), error => setSelection(String(error)))}>Pick documents…</Button>
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-selection`}>{selection}</Text>
  </ScrollView>;
}
