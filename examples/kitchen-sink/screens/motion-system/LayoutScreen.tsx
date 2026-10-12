import { Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { MotionPresence, MotionView } from "@legendapp/spark/motion";
import { PHOTOS, rowMotion, useOpenPhoto, useRows, useWide } from "./layout-demo";
import { useLayoutMessages } from "./layout-messages";
import { useWay } from "./motion-demo";
import { Actions, Page, Readout, Section } from "./MotionScreens";

// Test IDs: motion-system-layout-<part>. Rows, the frame box, thumbnails and the detail are MotionViews. The shared
// element comes first so its whole motion stays inside the window for frame captures.
const TONES = ["bg-success", "bg-danger", "bg-accent-primary"] as const;

export function Layout() {
  const t = useLayoutMessages();
  const way = useWay();
  const rows = useRows(), photo = useOpenPhoto(), frame = useWide();
  return <Page screen="layout">
    <Section title={t.shared} hint={t.sharedHint}>
      <Actions>
        {PHOTOS.map(id => <Button key={id} testID={`motion-system-layout-open-${id}`} onPress={() => photo.show(id)}>{t.open(id)}</Button>)}
        <Button testID="motion-system-layout-close" onPress={photo.close}>{t.close}</Button>
      </Actions>
      <View className="flex-row gap-3">
        {PHOTOS.map(id => <View key={id} style={{ width: 40, height: 40 }}>
          {photo.open !== id && <MotionView testID={`motion-system-layout-thumb-${id}`} sharedId={`motion-system-photo-${id}`} style={{ width: 40, height: 40 }}>
            <View className={`flex-1 rounded-md ${TONES[id % TONES.length]}`} />
          </MotionView>}
        </View>)}
      </View>
      <View style={{ height: 120 }}>
        {photo.open !== undefined && <MotionView key={photo.open} testID="motion-system-layout-detail" sharedId={`motion-system-photo-${photo.open}`} style={{ width: 200, height: 120 }}>
          <View className={`flex-1 rounded-xl ${TONES[photo.open % TONES.length]}`} />
        </MotionView>}
      </View>
    </Section>
    <Section title={t.presence} hint={t.presenceHint}>
      <Actions>
        <Button testID="motion-system-layout-add" onPress={rows.add}>{t.add}</Button>
        <Button testID="motion-system-layout-remove" onPress={rows.removeFirst}>{t.removeFirst}</Button>
        <Button testID="motion-system-layout-reorder" onPress={rows.lastToTop}>{t.lastToTop}</Button>
      </Actions>
      <Readout testID="motion-system-layout-rows" text={JSON.stringify(rows.ids)} />
      <View className="gap-2">
        <MotionPresence>
          {rows.ids.map(id => <MotionView key={id} testID={`motion-system-layout-row-${id}`} layout="position" transition={{ preset: "snappy" }} {...rowMotion(way, rows.added(id))}
            style={{ width: 256, height: 32 }}>
            <View className="flex-1 flex-row items-center gap-2 rounded-md border border-border bg-background px-3">
              <View className={`h-3 w-3 rounded-full ${TONES[id % TONES.length]}`} />
              <Text className="text-sm text-foreground">{t.item(id)}</Text>
            </View>
          </MotionView>)}
        </MotionPresence>
      </View>
    </Section>
    <Section title={t.frame} hint={t.frameHint}>
      <Actions><Button testID="motion-system-layout-toggle" onPress={frame.toggle}>{t.toggleSize}</Button></Actions>
      <View className="h-12 justify-center">
        <MotionView testID="motion-system-layout-frame" layout="frame" style={{ width: frame.wide ? 160 : 48, height: 40 }}>
          <View className="flex-1 rounded-md bg-success" />
        </MotionView>
      </View>
    </Section>
  </Page>;
}
