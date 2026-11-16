import { Text } from "react-native";

export function VisionCameraDemo() {
  return <Text selectable testID="media-vision-camera-unsupported" style={{ padding: 24 }}>Vision Camera is not supported on Windows. Camera capture and frame processing are unavailable.</Text>;
}
