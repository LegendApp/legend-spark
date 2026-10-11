import type { MenuWireItem } from "@legendapp/spark-desktop-app/src/contracts/menu";

/**
 * Internal: lets the development-only Developer menu attach native instructions to its own wire items, keyed by menu
 * owner id. Runs after validation, before publication. Nothing registers one in release bundles.
 */
export const wireDecorators = new Map<string, (items: MenuWireItem[]) => void>();
