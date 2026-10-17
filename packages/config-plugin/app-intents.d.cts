import type { AppIntentConfiguration, AppEnumConfiguration, AppEntityConfiguration, MacOSConfiguration } from "./config.d.cts";
type Declared = { intents: AppIntentConfiguration[]; enums: AppEnumConfiguration[]; entities: AppEntityConfiguration[] };
/** Validates macos.appIntents, appEnums and appEntities against each other and the app's localizations. */
export declare function validateAppIntents(macos: MacOSConfiguration | undefined, localizations?: string[]): Declared;
/** The Info.plist SparkAppIntents list @legendapp/spark/app-intents reads. */
export declare function appIntentDeclarations(declared: Partial<Declared> & Pick<Declared, "intents">, localizations?: string[]): { id: string; title: string; returnsText: boolean; parameters: Record<string, unknown>[] }[];
/** The Info.plist SparkAppEntities list. */
export declare function appEntityDeclarations(declared: Partial<Declared>, localizations?: string[]): { id: string; title: string }[];
/** SparkAppIntents.xcstrings and AppShortcuts.xcstrings, each undefined when nothing in it is translated. */
export declare function appIntentsStrings(declared: Partial<Declared> & Pick<Declared, "intents">, localizations?: string[]): Record<string, string | undefined>;
/** The Swift the app target compiles for the intents, enums and entities. */
export declare function appIntentsSwift(declared: Partial<Declared> & Pick<Declared, "intents">, localizations?: string[]): string;
/** Throws when the built app lacks the App Intents metadata of a declared intent, enum or entity. */
export declare function checkAppIntentsMetadata(app: string, macos: MacOSConfiguration | undefined): void;
