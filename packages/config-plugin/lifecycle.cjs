// macOS startup policy is opt-in and separate from portable window styling.
function validateLifecycle(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("macos.lifecycle must be an object");
  for (const key of Object.keys(value)) if (!["plugins", "mainWindow", "appearance"].includes(key)) throw new Error(`Unknown lifecycle option: ${key}`);
  if (value.plugins !== undefined && (!Array.isArray(value.plugins) || value.plugins.some(name => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) || new Set(value.plugins).size !== value.plugins.length)) throw new Error("lifecycle.plugins must contain unique native class names");
  if (value.appearance !== undefined && !["system", "light", "dark"].includes(value.appearance)) throw new Error("Invalid application appearance");
  const window = value.mainWindow ?? {};
  if (!window || typeof window !== "object" || Array.isArray(window)) throw new Error("lifecycle.mainWindow must be an object");
  const enums = { closeBehavior: ["close", "hide", "request"], reopenBehavior: ["default", "manual", "visibleWindows"], toolbarStyle: ["unified", "expanded"], titlebarSeparatorStyle: ["automatic", "none", "line", "shadow"] };
  for (const key of Object.keys(window)) if (!["hidden", "glass", "autosaveName", "backgroundColors", ...Object.keys(enums)].includes(key)) throw new Error(`Unknown mainWindow option: ${key}`);
  for (const key of ["hidden", "glass"]) if (window[key] !== undefined && typeof window[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  for (const [key, values] of Object.entries(enums)) if (window[key] !== undefined && !values.includes(window[key])) throw new Error(`Invalid ${key}`);
  if (window.autosaveName !== undefined && (typeof window.autosaveName !== "string" || !window.autosaveName.length)) throw new Error("autosaveName must be a nonempty string");
  if (window.backgroundColors !== undefined) {
    const colors = window.backgroundColors;
    if (!colors || typeof colors !== "object" || Array.isArray(colors) || Object.keys(colors).some(key => !["light", "dark"].includes(key)) || ["light", "dark"].some(key => typeof colors[key] !== "string" || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(colors[key]))) throw new Error("backgroundColors needs light and dark hex colors");
  }
  return value;
}
module.exports = { validateLifecycle };
