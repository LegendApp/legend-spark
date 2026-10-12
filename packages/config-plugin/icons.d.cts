/** A digest of the configured app icon's contents for `platform`, or undefined without an icon. */
export declare function iconDigest(config: Record<string, unknown>, projectRoot: string, platform: string): string | undefined;
/** macOS app icon point sizes; each is built at 1x and 2x. */
export declare const MACOS_SIZES: readonly number[];
/** The sizes in a Windows app icon (.ico). */
export declare const WINDOWS_SIZES: readonly number[];
/** The configured icon for `platform`, or undefined; throws when the path is not a PNG (or, on macOS, an .icon document). */
export declare function iconSource(config: Record<string, unknown>, projectRoot: string, platform: string): { file: string; kind: "icon" | "png" } | undefined;
/** Writes the macOS icon into the generated project (`project` is its parsed Xcode project). */
export declare function applyMacOSIcon(project: unknown, nativeRoot: string, source: { file: string; kind: "icon" | "png" }): Promise<void>;
/** Writes the Windows icon into every .ico of the generated app project. */
export declare function applyWindowsIcon(nativeRoot: string, source: { file: string; kind: "icon" | "png" }): Promise<void>;
