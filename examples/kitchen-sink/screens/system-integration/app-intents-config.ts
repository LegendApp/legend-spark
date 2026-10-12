export const RECIPE_INTENT = "ksShowRecipe";
export const TIMER_INTENT = "ksStartTimer";
/**
 * The intents this screen handles, as macos.appIntents would declare them. The Kitchen Sink declares none, so its
 * builds never add actions to Shortcuts, Spotlight or Siri on the Mac that runs them: a test-driver run declares them
 * through the simulation, and the manual flow adds this block to desktop.config.json (docs/app-intents.md#kitchen-sink).
 */
export const KS_APP_INTENTS = [
  { id: RECIPE_INTENT, title: "Show Kitchen Sink Recipe", description: "Shows how to make a recipe for some servings.", returnsText: true,
    parameters: [{ name: "recipe", title: "Recipe", type: "string" }, { name: "servings", title: "Servings", type: "integer", optional: true }],
    shortcut: { phrases: ["Show a recipe in ${applicationName}"], shortTitle: "Show Recipe", systemImage: "fork.knife" } },
  { id: TIMER_INTENT, title: "Start Kitchen Sink Timer", parameters: [{ name: "minutes", title: "Minutes", type: "number" }] },
] as const;
