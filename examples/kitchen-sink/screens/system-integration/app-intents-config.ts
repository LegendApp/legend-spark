export const RECIPE_INTENT = "ksShowRecipe";
export const TIMER_INTENT = "ksStartTimer";
export const NOTE_INTENT = "ksOpenNote";
export const NOTE_ENTITY = "KsNote";
/**
 * The intents this screen handles, with the enum and entity their parameters use, as macos.appIntents, macos.appEnums
 * and macos.appEntities would declare them, titled in each of the Kitchen Sink's localizations. The Kitchen Sink
 * declares none, so its builds never add actions to Shortcuts, Spotlight or Siri on the Mac that runs them: a
 * test-driver run declares them through the simulation, and the manual flow adds them to desktop.config.json
 * (docs/app-intents.md#kitchen-sink).
 */
export const KS_APP_ENUMS = [
  { id: "KsRecipe", title: { en: "Recipe", ar: "وصفة", fr: "Recette" }, cases: [
    { value: "pancakes", title: { en: "Pancakes", ar: "فطائر", fr: "Crêpes" } },
    { value: "gazpacho", title: { en: "Gazpacho", ar: "غازباتشو", fr: "Gaspacho" } },
    { value: "soup", title: { en: "Soup", ar: "حساء", fr: "Soupe" } },
  ] },
] as const;
export const KS_APP_ENTITIES = [{ id: NOTE_ENTITY, title: { en: "Note", ar: "ملاحظة", fr: "Note" } }] as const;
export const KS_APP_INTENTS = [
  { id: RECIPE_INTENT, title: { en: "Show Kitchen Sink Recipe", ar: "عرض وصفة من Kitchen Sink", fr: "Afficher une recette Kitchen Sink" },
    description: { en: "Shows how to make a recipe for some servings.", ar: "يعرض طريقة تحضير وصفة لعدد من الحصص.", fr: "Montre comment préparer une recette pour quelques portions." },
    returnsText: true,
    parameters: [
      { name: "recipe", title: { en: "Recipe", ar: "وصفة", fr: "Recette" }, type: "KsRecipe" },
      { name: "servings", title: { en: "Servings", ar: "الحصص", fr: "Portions" }, type: "integer", default: 1 },
    ],
    parameterSummary: { en: "Show ${recipe} for ${servings}", ar: "اعرض ${recipe} لـ ${servings}", fr: "Afficher ${recipe} pour ${servings}" },
    shortcut: {
      phrases: [
        { en: "Show ${recipe} in ${applicationName}", ar: "اعرض ${recipe} في ${applicationName}", fr: "Afficher ${recipe} dans ${applicationName}" },
        { en: "Show a recipe in ${applicationName}", ar: "اعرض وصفة في ${applicationName}", fr: "Afficher une recette dans ${applicationName}" },
      ],
      shortTitle: { en: "Show Recipe", ar: "عرض الوصفة", fr: "Afficher la recette" }, systemImage: "fork.knife",
    } },
  { id: TIMER_INTENT, title: { en: "Start Kitchen Sink Timer", ar: "بدء مؤقت Kitchen Sink", fr: "Démarrer le minuteur Kitchen Sink" },
    parameters: [{ name: "minutes", title: { en: "Minutes", ar: "الدقائق", fr: "Minutes" }, type: "number" }] },
  { id: NOTE_INTENT, title: { en: "Open Kitchen Sink Note", ar: "فتح ملاحظة من Kitchen Sink", fr: "Ouvrir une note Kitchen Sink" }, returnsText: true, openApp: true,
    parameters: [{ name: "note", title: { en: "Note", ar: "ملاحظة", fr: "Note" }, type: NOTE_ENTITY }],
    parameterSummary: { en: "Open ${note}", ar: "افتح ${note}", fr: "Ouvrir ${note}" } },
] as const;
