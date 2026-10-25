import Ajv from "ajv";
import { parseAccelerator } from "../../../packages/desktop-app/src/contracts/accelerator.ts";
import { COMMANDS, isBare, type CommandSpec } from "./commands.ts";
import {
  anyStr, bool, byType, CHECK_ID, commands, condition, DEFINITIONS, dict, duration, int, list, MATRIX, obj, oneOf, percent, PLATFORMS, str, SURFACE_ID, type Schema,
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
        additionalProperties: obj({
          title: str,
          platforms: { ...list(oneOf(...PLATFORMS)), uniqueItems: true },
          blocking: bool,
          spec: str,
          covers: { ...list(SURFACE_ID), uniqueItems: true, description: "The @legendapp/spark surface this check verifies (see bun run e2e:coverage)." },
        }, ["title"]),
      },
    }, ["area", "prefix", "checks"]),
  };
}

const ID = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" };
const machineId = (description: string): Schema => ({ ...ID, description });

export function buildGateSchema(): Schema {
  const artifact = obj({
    artifact: { ...str, description: "The release build to test, relative to the repository root. ${ARCH} becomes the target's arch (arm64 or x64)." },
    verifySignature: bool,
  }, ["artifact"]);
  return {
    $schema: DRAFT,
    title: "Spark e2e gate manifest",
    description: "e2e/gate.yaml: the release-gate suite. Paths in include, budgets and coverage.checks are relative to e2e/; build, signoffs and report paths are relative to the repository root. See docs/e2e-flows.md#release-gate.",
    ...obj({
      suite: str,
      appId: str,
      build: obj({ macos: artifact, windows: artifact }, [], { minProperties: 1 }),
      targets: {
        ...list(obj({
          os: { type: "string", pattern: "^(macos|windows)-\\d+$" },
          arch: oneOf("arm64", "x64"),
          machine: machineId("A reference machine from the budgets file: this target runs on that hardware and checks its budgets."),
        }, ["os", "arch"])),
        uniqueItems: true,
      },
      include: { ...list(str), description: "Globs of gate flows, such as flows/**." },
      blocking: obj({
        tags: { ...list(str, 0), description: "A flow with one of these tags blocks the release when it fails." },
        default: { ...bool, description: "Whether every other flow blocks too. A flow listing a check registered `blocking: true` always blocks." },
      }, ["tags", "default"]),
      retries: { enum: [0], description: "Flaky = failed: the gate never retries." },
      timeBudget: { ...DEFINITIONS.duration, description: "The longest the whole gate run may take; flows still running then fail." },
      budgets: { ...str, description: "The performance budgets file (per reference machine)." },
      coverage: obj({ checks: { ...str, description: "The check registry directory." }, exports: bool, availability: bool }, ["checks", "exports", "availability"]),
      signoffs: { ...str, description: "Manual sign-offs for this build (see docs/e2e-flows.md#manual-sign-offs)." },
      report: obj({ json: str, html: str }, ["json", "html"]),
    }, ["suite", "appId", "build", "targets", "include", "blocking", "retries", "timeBudget", "budgets", "coverage", "signoffs", "report"]),
  };
}

export function buildBudgetsSchema(): Schema {
  return {
    $schema: DRAFT,
    title: "Spark e2e performance budgets",
    description: "e2e/budgets.yaml: metric baselines per reference machine. See docs/e2e-flows.md#budgets.",
    ...obj({
      machines: {
        type: "object",
        minProperties: 1,
        propertyNames: ID,
        additionalProperties: obj({
          name: str,
          model: { ...str, description: "The Mac model identifier (sysctl hw.model), such as MacBookAir10,1." },
          memoryGB: int(1),
        }, ["name", "model", "memoryGB"]),
      },
      budgets: list(obj({
        metric: { type: "string", pattern: "^[a-z][A-Za-z0-9]*(\\.[A-Za-z0-9-]+)+$", description: "A metric flows record, such as startup.coldMs (see docs/e2e-flows.md#metrics)." },
        description: str,
        better: oneOf("lower", "higher"),
        tolerance: { ...percent, description: "How far a measurement may be worse than the baseline, such as 10%." },
        blocking: { ...bool, description: "Default true: a regression, a missing baseline or a missing measurement fails the gate." },
        flows: { ...list(str), description: "Globs of the flows this budget applies to (default: every gate flow that records the metric)." },
        baselines: {
          type: "object",
          minProperties: 1,
          propertyNames: machineId("a machine from machines"),
          additionalProperties: { if: { type: "string" }, then: { enum: ["not-measured"] }, else: { type: "number", minimum: 0 }, description: "The measured value on that machine, or not-measured." },
        },
      }, ["metric", "better", "tolerance", "baselines"]), 0),
    }, ["machines", "budgets"]),
  };
}

export function buildSignoffsSchema(): Schema {
  return {
    $schema: DRAFT,
    title: "Spark e2e manual sign-offs",
    description: "Sign-offs for manual flows, one per flow run, target and commit. See docs/e2e-flows.md#manual-sign-offs.",
    ...obj({
      signoffs: list(obj({
        flow: { ...str, description: "The flow run ID from the gate report, such as flows/ime/candidate[appearance=dark]." },
        target: { ...str, description: "The gate target, such as macos-15/arm64." },
        commit: { type: "string", pattern: "^[0-9a-f]{40}$", description: "a full 40-character commit SHA" },
        verdict: oneOf("pass", "fail"),
        by: { ...str, description: "Who signed off." },
        at: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})$", description: "an ISO 8601 timestamp, such as 2026-10-10T12:00:00Z" },
        evidence: { ...list(str, 0), description: "Screenshots or recordings, relative to the repository root." },
        note: str,
      }, ["flow", "target", "commit", "verdict", "by", "at"]), 0),
    }, ["signoffs"]),
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
ajv.addSchema(buildFlowSchema(), "flow").addSchema(buildRegistrySchema(), "checks").addSchema(buildGateSchema(), "gate")
  .addSchema(buildBudgetsSchema(), "budgets").addSchema(buildSignoffsSchema(), "signoffs");

export const validators = {
  header: ajv.compile({ $ref: "flow#/definitions/header" }),
  commands: ajv.compile({ $ref: "flow#/definitions/commandList" }),
  registry: ajv.getSchema("checks")!,
  gate: ajv.getSchema("gate")!,
  budgets: ajv.getSchema("budgets")!,
  signoffs: ajv.getSchema("signoffs")!,
};
