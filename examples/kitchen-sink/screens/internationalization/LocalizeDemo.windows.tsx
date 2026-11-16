import { Text } from "react-native";

export function LocalizeDemo() {
  return <Text selectable testID="internationalization-localize-unsupported" style={{ padding: 24 }}>react-native-localize has no Windows implementation: its native module ships only for Apple and Android platforms. Locale, country, time zone and number settings are unavailable through it on Windows.</Text>;
}
