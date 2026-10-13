import { useRef } from "react";
import { Text, View } from "react-native";
import { MotionView, type MotionTarget } from "@legendapp/spark/motion";
import { isRTL, type Locale } from "../../shell/i18n";
import { sharedId, tone, usePhoto, type Photo } from "./shared-windows-demo";
import { SHARED_WINDOWS_MESSAGES } from "./shared-windows-messages";

/** The photo window's React root: the photo, which flies in from its thumbnail and back when the window closes. */
export function SharedPhotoWindow({ photo, locale }: { photo: Photo; locale: Locale }) {
  const t = SHARED_WINDOWS_MESSAGES[locale];
  const target = useRef<MotionTarget>(null);
  usePhoto(target);
  return <View className="flex-1 items-center justify-center gap-3 bg-background" style={{ direction: isRTL(locale) ? "rtl" : "ltr" }} testID="motion-system-shared-windows-photo-window">
    <MotionView ref={target} testID="motion-system-shared-windows-photo" sharedId={sharedId(photo)} sharedAcrossWindows style={{ width: 200, height: 150 }}>
      <View className={`flex-1 rounded-xl ${tone(photo)}`} />
    </MotionView>
    <Text className="text-sm text-foreground">{t.caption(photo)}</Text>
  </View>;
}
