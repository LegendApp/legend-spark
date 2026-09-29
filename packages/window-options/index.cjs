const enums = {
  titleBarStyle: ["default", "overlay", "hidden", "borderless"],
  appearance: ["system", "light", "dark"],
};
const booleans = ["resizable", "closable", "minimizable", "alwaysOnTop", "transparent", "hasShadow", "restoreBounds"];
const dimension = { type: "number", minimum: 100, maximum: 20000 };
const size = { type: "object", required: ["width", "height"], additionalProperties: false, properties: { width: dimension, height: dimension } };
const materials = ["none", "sidebar", "windowBackground", "hudWindow", "popover"];
const schema = {
  type: "object", additionalProperties: false,
  properties: {
    size, minSize: { anyOf: [size, { type: "null" }] }, maxSize: { anyOf: [size, { type: "null" }] },
    ...Object.fromEntries(booleans.map(key => [key, { type: "boolean" }])),
    ...Object.fromEntries(Object.entries(enums).map(([key, values]) => [key, { enum: values }])),
    title: { type: "string" }, backgroundColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" },
    macos: { type: "object", additionalProperties: false, properties: {
      backgroundMaterial: { enum: materials },
      titleBar: { type: "object", additionalProperties: false, properties: { trafficLights: { type: "boolean" } } },
    } },
  },
};
function object(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} option: ${key}`);
}
function validateWindow(options) {
  object(options, Object.keys(schema.properties), "window");
  for (const key of ["size", "minSize", "maxSize"]) if (options[key] !== undefined && !(key !== "size" && options[key] === null)) {
    object(options[key], ["width", "height"], key);
    for (const axis of ["width", "height"]) if (!Number.isFinite(options[key][axis]) || options[key][axis] < 100 || options[key][axis] > 20000) throw new Error(`${key}.${axis} must be between 100 and 20000 logical units`);
  }
  for (const axis of ["width", "height"]) {
    const min = options.minSize?.[axis] ?? 100, max = options.maxSize?.[axis] ?? 20000;
    if (min > max) throw new Error(`minSize.${axis} exceeds maxSize.${axis}`);
    if (options.size && (options.size[axis] < min || options.size[axis] > max)) throw new Error(`size.${axis} is outside its constraints`);
  }
  for (const key of booleans) if (options[key] !== undefined && typeof options[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  for (const [key, values] of Object.entries(enums)) if (options[key] !== undefined && !values.includes(options[key])) throw new Error(`Invalid ${key}`);
  if (options.title !== undefined && typeof options.title !== "string") throw new Error("title must be a string");
  if (options.backgroundColor !== undefined && (typeof options.backgroundColor !== "string" || !new RegExp(schema.properties.backgroundColor.pattern).test(options.backgroundColor))) throw new Error("backgroundColor must be #RRGGBB or #RRGGBBAA");
  if (options.macos !== undefined) {
    object(options.macos, ["backgroundMaterial", "titleBar"], "macos");
    if (options.macos.backgroundMaterial !== undefined && !materials.includes(options.macos.backgroundMaterial)) throw new Error("Invalid macos.backgroundMaterial");
    if (options.macos.titleBar !== undefined) {
      object(options.macos.titleBar, ["trafficLights"], "macos.titleBar");
      if (options.macos.titleBar.trafficLights !== undefined && typeof options.macos.titleBar.trafficLights !== "boolean") throw new Error("trafficLights must be a boolean");
    }
  }
  return options;
}
// Private host transport. Consumers only author the grouped configuration above.
function nativeWindowOptions(value) {
  const { size, minSize, maxSize, restoreBounds, macos, ...result } = validateWindow(value);
  for (const [prefix, dimensions] of [["", size], ["min", minSize], ["max", maxSize]]) if (dimensions) {
    for (const axis of ["width", "height"]) result[prefix ? prefix + axis[0].toUpperCase() + axis.slice(1) : axis] = dimensions[axis];
  }
  if (restoreBounds !== undefined) result.restoreFrame = restoreBounds;
  if (macos?.backgroundMaterial !== undefined) result.material = macos.backgroundMaterial;
  if (macos?.titleBar?.trafficLights !== undefined) result.trafficLights = macos.titleBar.trafficLights;
  return result;
}
module.exports = { validateWindow, nativeWindowOptions, schema };
