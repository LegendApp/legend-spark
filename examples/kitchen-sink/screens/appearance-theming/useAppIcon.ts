import { useState } from "react";
import { fromByteArray } from "base64-js";
import { getAppIcon, getAppIconAvailability } from "@legendapp/spark/files";
import { useRegistrations } from "../../shell/registrations";
import { describeError } from "./useAppearancePreferences";

/** Pixel sizes the screen renders: the Finder list and icon views and the Dock at 1x and 2x. */
export const ICON_SIZES = [16, 32, 64, 128, 256, 512] as const;
export type RenderedIcon = { size: number; uri: string; width: number; height: number };

/** A PNG's pixel dimensions, from its IHDR chunk. */
const dimensions = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

/**
 * The app's own icon from getAppIcon() at each of ICON_SIZES: what Finder and the Dock draw, in the icon style the
 * process sees. A launch with `-AppleIconAppearanceTheme <style>` renders another style in this process only.
 */
export function useAppIcon() {
  const [icons, setIcons] = useState<readonly RenderedIcon[]>();
  const [error, setError] = useState<string>();
  useRegistrations(hold => {
    let current = true;
    hold({ remove: () => { current = false; } });
    Promise.all(ICON_SIZES.map(async size => {
      const png = await getAppIcon({ size });
      return { size, uri: `data:image/png;base64,${fromByteArray(png)}`, ...dimensions(png) };
    })).then(result => { if (current) setIcons(result); }, cause => { if (current) setError(describeError(cause)); });
  }, cause => setError(describeError(cause)), []);
  return { availability: getAppIconAvailability(), icons, error };
}
