import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { compileShaderLibrary, metalCompiler, readShaderHeader, SHADER_DIRECTORY, SHADER_SOURCE } from "../scripts/motion-shaders.ts";

// Motion's built-in Metal shaders are compiled ahead of time (`bun run motion:shaders`) into a header the app embeds;
// apps and CI never compile Metal source (docs/motion.md#shader-effects-and-particles).

test("the precompiled shader library is the current source's, and its bytes are the ones it records", () => {
  const header = readShaderHeader();
  expect(header.sourceSha256).toBe(createHash("sha256").update(readFileSync(SHADER_SOURCE)).digest("hex"));
  expect(header.librarySha256).toBe(header.sha256);
  expect(header.compiler).toMatch(/^Apple metal version /);
  expect(header.bytes.subarray(0, 4).toString("latin1")).toBe("MTLB");
  for (const name of ["sparkDissolveVertex", "sparkDissolveFragment"]) expect(header.bytes.includes(Buffer.from(name))).toBe(true);
});

const compiler = process.platform === "darwin" ? metalCompiler() : undefined;
const recorded = readShaderHeader().compiler;
// Rebuilding gives the same bytes only with the compiler that built them; any other skips with its reason.
const skip = process.platform !== "darwin" ? "not macOS" : !compiler ? "no Metal toolchain (`xcodebuild -downloadComponent MetalToolchain`)"
  : compiler !== recorded ? `this Metal compiler (${compiler}) is not the one that built the library (${recorded})` : undefined;
test.skipIf(skip !== undefined)(`rebuilding the shader library gives the embedded bytes${skip ? ` (skipped: ${skip})` : ""}`, () => {
  expect(createHash("sha256").update(compileShaderLibrary()).digest("hex")).toBe(readShaderHeader().sha256);
}, 60000);

test("the podspec compiles no Metal source and links Metal", () => {
  const podspec = readFileSync(path.resolve(SHADER_DIRECTORY, "../RNSparkMotion.podspec"), "utf8");
  expect(podspec).toContain('"macos/**/*.{h,m,mm}"');
  expect(podspec).toMatch(/s\.frameworks = .*"Metal"/);
});
