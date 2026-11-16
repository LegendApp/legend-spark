import { SFSymbol } from "@legendapp/spark/ui/symbol";
import { PlatformColor, Text, View } from "react-native";
import { Panel } from "../../Panel";

const symbols = [
  { color: "#2563eb", name: "music.note.list", scale: "large", size: 72 },
  { color: "#16a34a", name: "play.circle.fill", scale: "large", size: 64 },
  { color: "#dc2626", name: "heart.fill", scale: "medium", size: 56 },
  { color: "#9333ea", name: "sparkles", scale: "medium", size: 56 },
  { color: "#ea580c", name: "speaker.wave.2.fill", scale: "small", size: 48 },
  { color: "#0f766e", name: "waveform", scale: "small", size: 48 },
] as const;

// System and dynamic colours resolve per appearance; converting them to RGB used to abort the app.
const platformSymbols = [
  { color: PlatformColor("systemRedColor"), label: "systemRedColor", name: "exclamationmark.triangle.fill" },
  { color: PlatformColor("controlAccentColor"), label: "controlAccentColor", name: "star.fill" },
  { color: PlatformColor("labelColor"), label: "labelColor", name: "textformat" },
];

export function SFSymbols() {
  return <Panel title="SF Symbol">
    <View className="max-w-xl flex-row flex-wrap items-center justify-center gap-5" testID="native-controls-symbol-grid">
      {symbols.map(symbol => <View key={symbol.name} className="min-h-28 w-40 items-center gap-2">
        <SFSymbol testID={`native-controls-symbol-${symbol.name.replace(/\./g, "-")}`} color={symbol.color} name={symbol.name} scale={symbol.scale} size={symbol.size} />
        <Text className="text-sm text-muted">{symbol.name}</Text>
      </View>)}
      {platformSymbols.map(symbol => <View key={symbol.label} className="min-h-28 w-40 items-center gap-2">
        <SFSymbol testID={`native-controls-symbol-platform-${symbol.label}`} color={symbol.color} name={symbol.name} scale="medium" size={48} />
        <Text className="text-sm text-muted">{symbol.label}</Text>
      </View>)}
    </View>
  </Panel>;
}
