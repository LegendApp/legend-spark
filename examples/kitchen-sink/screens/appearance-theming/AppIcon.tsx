import { Image, ScrollView, Text, View } from "react-native";
import { useAppIconMessages } from "./app-icon-messages";
import { useAppIcon } from "./useAppIcon";

// Test IDs under appearance-theming-app-icon: -availability, -error, -icons (the rendered row), -image-<size> and
// -size-<size> (the PNG's "<width>×<height>"), for each size in ICON_SIZES.
const ID = "appearance-theming-app-icon";
/** Each icon is drawn at half its pixel size, one image pixel per pixel of a Retina display. */
const points = (size: number) => size / 2;

/** The app's icon from getAppIcon() at the sizes Finder and the Dock draw. */
export function AppIcon() {
  const t = useAppIconMessages();
  const { availability, icons, error } = useAppIcon();
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-6" testID={`${ID}-content`}>
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{t.title}</Text>
    <Text className="max-w-2xl text-sm text-muted">{t.intro}</Text>
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{t.availability}</Text>
    <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-availability`}>{JSON.stringify(availability)}</Text>
    {error ? <Text selectable className="font-mono text-xs text-danger" testID={`${ID}-error`}>{error}</Text> : null}
    <Text className="text-base font-semibold text-foreground" accessibilityRole="header">{t.rendered}</Text>
    {icons ? <View className="flex-row flex-wrap items-end gap-4 rounded-md border border-border p-3" testID={`${ID}-icons`}>
      {icons.map(icon => <View key={icon.size} className="items-center gap-1">
        <Image testID={`${ID}-image-${icon.size}`} accessibilityLabel={t.image(icon.size)} source={{ uri: icon.uri }} style={{ width: points(icon.size), height: points(icon.size) }} />
        <Text className="text-xs text-muted">{t.size(icon.size)}</Text>
        <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-size-${icon.size}`}>{`${icon.width}×${icon.height}`}</Text>
      </View>)}
    </View> : <Text className="text-sm text-muted">{error ? "—" : t.loading}</Text>}
    <Text className="max-w-2xl text-xs text-muted">{t.styles}</Text>
  </ScrollView>;
}
