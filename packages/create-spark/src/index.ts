#!/usr/bin/env node
import { createSpark } from "./create.ts";

createSpark(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
