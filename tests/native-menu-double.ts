import type { MenuWireItem } from "../packages/desktop-app/src/contracts/menu";

/**
 * What RNNativeMenu's publish resolves with on macOS: each published item's shown title by owner token and item ID.
 * Items show their published titles unless `shown` gives the native one (a located root's localized title).
 */
export function shownMenuTitles(json: string, shown: Record<string, string> = {}): string {
  const titles: Record<string, Record<string, string>> = {};
  const visit = (items: readonly MenuWireItem[]) => {
    for (const item of items) {
      if (item.separator) continue;
      (titles[item._sparkOwner!] ??= {})[item.id!] = shown[item.id!] ?? item.title ?? item.role!;
      if (item.items) visit(item.items);
    }
  };
  visit(JSON.parse(json));
  return JSON.stringify(titles);
}

/** Wraps a publish mock: on macOS, a publication that resolves without a value reports the shown titles, as the native module does. */
export const reportingTitles = (publish: (json: string) => unknown, macos: () => boolean = () => true) =>
  async (json: string) => { const result = await publish(json); return macos() && result == null ? shownMenuTitles(json) : result; };
