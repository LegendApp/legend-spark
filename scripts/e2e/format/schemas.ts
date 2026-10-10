import Ajv from "ajv";
import { parseAccelerator } from "../../../packages/desktop-app/src/contracts/accelerator.ts";
import { COMMANDS, isBare, type CommandSpec } from "./commands.ts";
import {
  anyStr, bool, byType, CHECK_ID, commands, condition, DEFINITIONS, dict, duration, list, MATRIX, obj, oneOf, PLATFORMS, str, type Schema,
} from "./primitives.ts";

const DRAFT = "http://json-schema.org/draft-07/schema#";
const header = (summary: string, spec: CommandSpec) => [spec.driver && "[driver]", spec.maestro && "[maestro]", summary].filter(Boolean).join(" ");

/** The mapping form, with the `when` condition and `timeout` every command accepts. */
export function mappingSchema(spec: CommandSpec): Schema {
  const props = { ...spec.props, ...("when" in spec.props ? {} : { when: condition }), ...("timeout" in spec.props ? {} : { timeout: duration }) };
  return obj(props, spec.required, spec.rule);
}

function argumentSchema(spec: CommandSpec): Schema {
  const shorthand = spec.shorthand ? spec.props[spec.shorthand]! : undefined;
  const other = shorthand && isBare(spec) ? { if: { type: "null" }, else: shorthand } : shorthand ?? (isBare(spec) ? { type: "null" } : { type: "object" });
  return { description: header(spec.summary, spec), ...byType(mappingSchema(spec), other) };
}

export function buildFlowSchema(): Schema {
  const names = Object.keys(COMMANDS);
  return {
    $schema: DRAFT,
    title: "Spark e2e flow",
    description: "A flow is a header document, `---`, then a command list. A subflow is a command list only. See docs/e2e-flows.md.",
    ...byType({ $ref: "#/definitions/header" }, { $ref: "#/definitions/commandList" }),
    definitions: {
      header: obj({
        appId: str,
        name: str,
        intent: { ...str, description: "Plain-English behavior under test; agents use it to repair broken flows." },
        checks: { type: "array", items: str, description: "Check IDs from e2e/checks/<area>.yaml." },
        tags: list(str, 0),
        platforms: { ...list(oneOf(...PLATFORMS)), uniqueItems: true },
        build: oneOf("release", "dev"),
        manual: oneOf(false, "partial", true),
        timeout: duration,
        matrix: obj(Object.fromEntries(Object.entries(MATRIX).map(([key, value]) => [key, { ...list(value), uniqueItems: true }])), [], { minProperties: 1 }),
        env: dict(anyStr),
        onFlowStart: commands,
        onFlowComplete: commands,
      }, ["appId", "name"]),
      commandList: list({ $ref: "#/definitions/command" }),
      command: {
        if: { type: "string" },
        then: { enum: names.filter(name => isBare(COMMANDS[name]!)) },
        else: {
          type: "object",
          minProperties: 1,
          maxProperties: 1,
          properties: Object.fromEntries(names.map(name => [name, argumentSchema(COMMANDS[name]!)])),
          additionalProperties: false,
        },
      },
      ...DEFINITIONS,
    },
  };
}

export function buildRegistrySchema(): Schema {
  return {
    $schema: DRAFT,
    title: "Spark e2e check registry",
    description: "e2e/checks/<area>.yaml: one file per area. Check IDs are <prefix>-<NAME>-<NN>.",
    ...obj({
      area: { type: "string", pattern: "^[a-z][a-z0-9-]*$", description: "the area name; must match the file name" },
      prefix: { type: "string", pattern: "^[A-Z][A-Z0-9]*$", description: "the check ID prefix, such as WIN" },
      checks: {
        type: "object",
        minProperties: 1,
        propertyNames: { pattern: CHECK_ID },
        additionalProperties: obj({ title: str, platforms: { ...list(oneOf(...PLATFORMS)), uniqueItems: true }, blocking: bool, spec: str }, ["title"]),
      },
    }, ["area", "prefix", "checks"]),
  };
}

export function buildGateSchema(): Schema {
  const artifact = obj({ artifact: str, install: bool, cleanUser: bool, verifySignature: bool }, ["artifact"]);
  return {
    $schema: DRAFT,
    title: "Spark e2e gate manifest",
    description: "e2e/gate.yaml: the release-gate suite.",
    ...obj({
      suite: str,
      appId: str,
      build: obj({ macos: artifact, windows: artifact }, [], { minProperties: 1 }),
      targets: list(obj({ os: { type: "string", pattern: "^(macos|windows)-\\d+$" }, arch: oneOf("arm64", "x86_64", "x64") }, ["os", "arch"])),
      include: list(str),
      blocking: obj({ tags: list(str), default: bool }),
      retries: { enum: [0], description: "Flaky = failed: the gate never retries." },
      budgets: str,
      coverage: obj({ checks: str, exports: bool, availability: bool }),
      report: obj({ json: str, junit: str, html: str }, [], { minProperties: 1 }),
    }, ["suite", "appId", "build", "targets", "include"]),
  };
}

/** Why a value fails a custom format, or undefined when it is valid. */
export function formatProblem(format: string, value: string): string | undefined {
  try {
    if (format === "accelerator") parseAccelerator(value, "macos", { allowUnmodifiedCharacter: true, allowExtendedKeys: true });
    else if (format === "text-pattern" && value.length > 1 && value.startsWith("/") && value.endsWith("/")) new RegExp(value.slice(1, -1), "u");
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

export const ajv = new Ajv({ allErrors: true, verbose: true, strict: true, strictRequired: false, allowUnionTypes: true });
for (const format of ["accelerator", "text-pattern"]) ajv.addFormat(format, { type: "string", validate: value => formatProblem(format, value) === undefined });
ajv.addSchema(buildFlowSchema(), "flow").addSchema(buildRegistrySchema(), "checks").addSchema(buildGateSchema(), "gate");

export const validators = {
  header: ajv.compile({ $ref: "flow#/definitions/header" }),
  commands: ajv.compile({ $ref: "flow#/definitions/commandList" }),
  registry: ajv.getSchema("checks")!,
  gate: ajv.getSchema("gate")!,
};
