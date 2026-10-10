/** JSON Schema (draft-07) building blocks shared by the command catalog and the generated schemas. */
export type Schema = Record<string, unknown>;

export const CHECK_ID = "^[A-Z][A-Z0-9]*-[A-Z0-9]+-\\d{2}$";
export const PLATFORMS = ["macos", "windows"] as const;

const ref = (name: string): Schema => ({ $ref: `#/definitions/${name}` });
const described = (schema: Schema, description: string): Schema => ({ ...schema, description });

export const str: Schema = { type: "string", minLength: 1 };
export const anyStr: Schema = { type: "string" };
export const bool: Schema = { type: "boolean" };
export const num: Schema = { type: "number" };
export const anyValue: Schema = {};
export const int = (minimum = 0): Schema => ({ type: "integer", minimum });
export const fraction: Schema = { type: "number", minimum: 0, maximum: 1 };
export const oneOf = (...values: Array<string | number | boolean>): Schema => ({ enum: values });
export const list = (items: Schema, minItems = 1): Schema => ({ type: "array", items, minItems });
export const dict = (values: Schema): Schema => ({ type: "object", additionalProperties: values });
export const obj = (properties: Record<string, Schema>, required: string[] = [], rule: Schema = {}): Schema =>
  ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false, ...rule });
/** At least one of the keys must be present. */
export const anyKey = (...keys: string[]): Schema => ({ anyOf: keys.map(key => ({ required: [key] })) });
/** Exactly one of the keys must be present. */
export const oneKey = (...keys: string[]): Schema => ({ oneOf: keys.map(key => ({ required: [key] })) });
const pattern = (regex: string, description: string): Schema => ({ type: "string", pattern: regex, description });
/** Pick a schema by YAML value type, so errors come from the branch the author meant. */
export const byType = (object: Schema, other: Schema): Schema => ({ if: { type: "object" }, then: object, else: other });

export const percent = pattern("^\\d+(\\.\\d+)?%$", "a percentage such as 0.1%");
export const pixels = described({ type: ["string", "number"], pattern: "^\\d+(\\.\\d+)?px$", minimum: 0 }, "a length such as 4px (a bare number is pixels)");
export const point = pattern("^-?\\d+(\\.\\d+)?%?, ?-?\\d+(\\.\\d+)?%?$", "a point such as \"50%,20%\" or \"120,48\" (percent of the target, or points from its top-left)");
export const menuPath = pattern("^.+( > .+)+$", "a menu path such as \"File > Export > PDF…\"");
export const accelerator: Schema = { type: "string", minLength: 1, format: "accelerator" };
export const textString: Schema = { type: "string", minLength: 1, format: "text-pattern" };
export const bound = (value: Schema): Schema => obj({ min: value, max: value }, [], { minProperties: 1 });
export const size = obj({ w: num, h: num }, ["w", "h"]);
export const scope = oneOf("window", "app");
export const modifier = oneOf("cmd", "ctrl", "option", "alt", "shift", "fn");

export const duration = ref("duration");
export const selector = ref("selector");
export const windowSelector = ref("window");
export const condition = ref("condition");
export const text = ref("text");
export const command = ref("command");
export const commands = ref("commandList");
/** Fields whose values are nested commands; the parser turns them into FlowCommand values. */
export const NESTED = new Map<Schema, "one" | "many">([[command, "one"], [commands, "many"]]);

/** Keys that identify a target; a selector mapping must name at least one. */
export const TARGET_KEYS = ["id", "role", "label", "text", "point", "below", "above", "leftOf", "rightOf"];
export const SELECTOR_PROPS: Record<string, Schema> = {
  id: described(str, "testID: AX identifier on macOS, AutomationId on Windows"),
  role: described(str, "accessibility role, such as button, tab or textField"),
  label: text,
  text,
  within: selector,
  index: int(),
  window: windowSelector,
  below: selector,
  above: selector,
  leftOf: selector,
  rightOf: selector,
  point,
};
export const WINDOW_PROPS: Record<string, Schema> = { title: text, index: int(), type: str, id: str };
export const MATRIX = { appearance: oneOf("light", "dark"), locale: pattern("^[a-z]{2,3}(-[A-Za-z0-9]+)*$", "a locale such as en-US or ar"), reduceMotion: bool };

export const DEFINITIONS: Record<string, Schema> = {
  duration: described({ type: ["string", "integer"], pattern: "^\\d+(\\.\\d+)?(ms|s|m)$", minimum: 0 }, "a duration such as 120ms, 1.5s or 2m (a bare integer is milliseconds)"),
  text: described(byType(obj({ macos: textString, windows: textString }, [], { minProperties: 1 }), textString), "Visible text, a /regex/, or per-platform text { macos, windows }."),
  selector: described(byType(obj(SELECTOR_PROPS, [], anyKey(...TARGET_KEYS)), textString), "A bare string is visible text (or a /regex/); a mapping selects by id, role, label, relation or point."),
  window: described(byType(obj(WINDOW_PROPS, [], { minProperties: 1 }), oneOf("key", "main")), "key, main, or { title | index | type | id }."),
  condition: described(obj({
    platform: oneOf(...PLATFORMS),
    visible: selector,
    notVisible: selector,
    matrix: obj(MATRIX, [], { minProperties: 1 }),
  }, [], { minProperties: 1 }), "Run the command only when every listed condition holds."),
};
