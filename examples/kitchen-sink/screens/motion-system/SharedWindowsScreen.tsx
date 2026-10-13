import { useRef } from "react";
import { Text, View } from "react-native";
import { Button } from "@legendapp/spark/ui";
import { MotionView, type MotionTarget } from "@legendapp/spark/motion";
import { useI18n } from "../../shell/app-controller";
import { PHOTOS, closePhoto, openPhoto, sharedId, tone, useSharedWindows, useThumb, type Photo, type ViewMotion } from "./shared-windows-demo";
import { useSharedWindowsMessages } from "./shared-windows-messages";
import { Actions, Page, Readout, Section } from "./MotionScreens";

// Test IDs: motion-system-shared-windows-<part>. The thumbnails and the photo window's photo are MotionViews with the
// same sharedId and sharedAcrossWindows; readout IDs carry each view's engine state.
const motionId = (value: ViewMotion) => value ? `${value.moving ? "moving" : "still"}-scale-${value.scale}-opacity-${value.opacity}` : "none";

function Thumb({ photo }: { photo: Photo }) {
  const frame = useRef<View>(null), target = useRef<MotionTarget>(null);
  useThumb(photo, frame, target);
  return <View ref={frame} style={{ width: 40, height: 30 }}>
    <MotionView ref={target} testID={`motion-system-shared-windows-thumb-${photo}`} sharedId={sharedId(photo)} sharedAcrossWindows style={{ width: 40, height: 30 }}>
      <View className={`flex-1 rounded-md ${tone(photo)}`} />
    </MotionView>
  </View>;
}

export function SharedWindows() {
  const t = useSharedWindowsMessages();
  const { locale } = useI18n();
  const { reduceMotion, window, photo, thumbs, error } = useSharedWindows();
  const rows: [string, string, string][] = [
    [t.reduceMotionLabel, t.reduceMotion(reduceMotion), `motion-system-shared-windows-reduce-motion-${reduceMotion ?? "unknown"}`],
    [t.windowLabel, t.window[window], `motion-system-shared-windows-window-${window}`],
    [t.photoLabel, t.motion(photo), `motion-system-shared-windows-photo-${motionId(photo)}`],
    ...PHOTOS.map((id): [string, string, string] => [t.thumbLabel(id), t.motion(thumbs[id]), `motion-system-shared-windows-thumb-${id}-${motionId(thumbs[id])}`]),
  ];
  return <Page screen="shared-windows">
    <Section title={t.title} hint={t.hint}>
      <Actions>
        {PHOTOS.map(id => <Button key={id} testID={`motion-system-shared-windows-open-${id}`} onPress={() => { void openPhoto(id, locale, t.windowTitle(id)); }}>{t.open(id)}</Button>)}
        <Button testID="motion-system-shared-windows-close" onPress={() => { void closePhoto(); }}>{t.close}</Button>
      </Actions>
      <View className="flex-row gap-3">{PHOTOS.map(id => <Thumb key={id} photo={id} />)}</View>
      <View className="gap-1" testID="motion-system-shared-windows-readout">
        {rows.map(([label, value, testID]) => <View key={label} className="flex-row gap-3">
          <Text className="w-32 text-xs font-semibold text-foreground">{label}</Text>
          <Text className="flex-1 text-xs text-muted" testID={testID}>{value}</Text>
        </View>)}
      </View>
      {!!error && <Readout testID="motion-system-shared-windows-error" text={error} />}
    </Section>
  </Page>;
}
