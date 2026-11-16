import { Text } from "react-native";

export function RNFSDemo() {
  return <Text selectable testID="storage-data-rn-fs-unsupported" style={{ padding: 24 }}>@dr.pogodin/react-native-fs is not supported on Windows yet: its Windows module needs package identity (ApplicationData, Package) that Spark's unpackaged app doesn't have. File system access is unavailable through it on Windows.</Text>;
}
