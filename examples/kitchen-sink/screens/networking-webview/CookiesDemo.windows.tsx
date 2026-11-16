import { Text } from "react-native";

export function CookiesDemo() {
  return <Text selectable testID="networking-webview-cookies-unsupported" style={{ padding: 24 }}>@react-native-cookies/cookies has no Windows implementation: the library supports only Apple and Android platforms. Cookie stores are unavailable through it on Windows.</Text>;
}
