/// <reference types="expo/types/metro-require" />
import { createCatalog } from "./registry";

// Each area owns screens/<area>/index.tsx; adding one edits no shared file.
const context = require.context("../screens", true, /^\.\/[^/]+\/index\.tsx?$/);
export const catalog = createCatalog(context.keys().map(key => [key, context(key)] as const));
