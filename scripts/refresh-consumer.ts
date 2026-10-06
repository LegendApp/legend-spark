import path from "node:path";
import { refreshLocalPackages } from "../packages/cli/src/create.ts";
if (!process.argv[2]) throw new Error("Usage: bun scripts/refresh-consumer.ts <external project>");
await refreshLocalPackages(path.resolve(process.argv[2]), path.resolve(import.meta.dirname, "../artifacts/packages/manifest.json"));
