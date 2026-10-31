import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as ImagePicker from "expo-image-picker";

// Test IDs: media-image-picker-passed, or -failed with the failing cases. Picking opens an open panel,
// which the driver can't operate, so the check covers the module, permissions and the camera's absence.
const ID = "media-image-picker";

async function check() {
  const library = await ImagePicker.getMediaLibraryPermissionsAsync();
  const camera = await ImagePicker.getCameraPermissionsAsync();
  const cameraError = await ImagePicker.launchCameraAsync().then(() => "resolved", (error: { code?: string }) => error.code);
  return [
    requireOptionalNativeModule("ExponentImagePicker") == null && "native module",
    !library.granted && `library permission (${library.status})`,
    !["granted", "denied", "undetermined"].includes(camera.status) && `camera permission (${camera.status})`,
    cameraError !== "ERR_UNAVAILABLE" && `launchCameraAsync (${cameraError})`,
  ].filter(Boolean);
}

/** expo-image-picker through its own API; Spark's patch picks image and movie files with an open panel on macOS. */
export function ImagePickerDemo() {
  const [result, setResult] = useState<string>();
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset[]>([]);
  useEffect(() => { check().then(failures => setResult(failures.length ? `failed: ${failures.join(", ")}` : "passed"), error => setResult(`failed: ${String(error)}`)); }, []);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-foreground" testID={result ? `${ID}-${result === "passed" ? "passed" : "failed"}` : undefined}>{result ?? "running"}</Text>
    <Pressable className="self-start rounded-md bg-highlight px-3 py-2" onPress={() => void ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true }).then(response => setPicked(response.assets ?? []))}>
      <Text className="text-foreground">Pick images or videos…</Text>
    </Pressable>
    {picked.map(asset => <Text key={asset.uri} selectable className="font-mono text-xs text-muted">{`${asset.type} ${asset.width}×${asset.height} ${asset.mimeType} ${asset.fileName}`}</Text>)}
    {picked.filter(asset => asset.type === "image").map(asset => <Image key={asset.uri} source={{ uri: asset.uri }} style={{ width: 160, height: 120 }} resizeMode="contain" />)}
  </ScrollView>;
}
