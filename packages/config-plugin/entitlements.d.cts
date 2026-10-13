export type Entitlements = Record<string, unknown>;
/** Combines entitlement requirements: arrays are joined; conflicting scalars throw. */
export declare function mergeEntitlements(...sources: Entitlements[]): Entitlements;
/** The app's entitlements: native packages' requirements, macos.authentication, macos.capture and macos.entitlements. */
export declare function resolveEntitlements(config: unknown, packages: Array<{ spark?: { entitlements?: { macos?: Entitlements } } }>): Entitlements;
export declare function authenticationEntitlements(authentication: unknown): Entitlements;
export declare function captureEntitlements(capture: unknown): Entitlements;
/** Validates macos.sandbox (docs/app-sandbox.md). */
export declare function validateSandbox(sandbox: unknown): void;
/** The App Sandbox variant's main executable: `appEntitlements`, macos.sandbox.entitlements and app-sandbox. Throws without macos.sandbox. */
export declare function sandboxEntitlements(config: unknown, appEntitlements: Entitlements): Entitlements;
/** What every other process of the App Sandbox variant carries: app-sandbox and inherit. */
export declare const SANDBOX_INHERIT: Readonly<Entitlements>;
/** The native packages the App Sandbox variant leaves out (Sparkle's). */
export declare const SANDBOX_EXCLUDED: readonly string[];
