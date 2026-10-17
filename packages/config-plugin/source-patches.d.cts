/** Expo Desktop's template renaming module source, with its rename glob kept out of node_modules. */
export declare function patchTemplateRenameSource(source: string): string;
/** Installs the template rename patch into the app's installed expo-desktop. */
export declare function installTemplateRenamePatch(root: string): void;
/** Installs every Spark patch to the app's installed packages' sources; a patched source is left as it is. */
export declare function installSourcePatches(root: string): void;
