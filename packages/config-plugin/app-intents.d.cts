import type { AppIntentConfiguration } from "./config.d.cts";
/** Validates macos.appIntents and returns it. */
export declare function validateAppIntents(value: unknown): AppIntentConfiguration[];
/** The Info.plist SparkAppIntents list @legendapp/spark/app-intents reads. */
export declare function appIntentDeclarations(intents: readonly AppIntentConfiguration[]): { id: string; title: string; returnsText: boolean; parameters: { name: string; title: string; type: string; optional: boolean }[] }[];
/** The Swift the app target compiles for the intents. */
export declare function appIntentsSwift(intents: readonly AppIntentConfiguration[]): string;
/** Throws when the built app lacks the App Intents metadata of a declared intent. */
export declare function checkAppIntentsMetadata(app: string, intents: readonly AppIntentConfiguration[] | undefined): void;
