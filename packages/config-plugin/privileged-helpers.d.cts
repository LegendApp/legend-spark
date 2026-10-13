import type { HelperConfiguration } from "./config.d.cts";
/** Validates macos.privilegedHelpers against the declared helpers. */
export declare function validatePrivilegedHelpers(names: unknown, helpers?: Record<string, HelperConfiguration>): void;
/** The helper's executable relative to the app bundle, where spark build copies it. */
export declare function privilegedHelperProgram(name: string, helper: HelperConfiguration, arch: "arm64" | "x64"): string;
/** The launch daemon plist (XML) for <bundleIdentifier>.<name>. */
export declare function privilegedHelperPlist(bundleIdentifier: string, name: string, program: string): string;
/** Each embedded helper's required signing identifier (its launchd label), by its path relative to the app bundle. */
export declare function privilegedHelperIdentifiers(app: string): Record<string, string>;
/** Writes Contents/Library/LaunchDaemons/<bundleIdentifier>.<name>.plist for each helper in macos.privilegedHelpers; returns the files. */
export declare function writePrivilegedHelpers(app: string, macos: { bundleIdentifier: string; privilegedHelpers?: string[] } | undefined, helpers: Record<string, HelperConfiguration> | undefined, arch: "arm64" | "x64"): string[];
