#import <AppKit/AppKit.h>

// Spark's own native strings live in Localization/<language>.lproj/Spark.strings (the SparkStrings
// resource bundle). Like AppKit's strings they resolve in the language this launch chose for the
// app: the first of the user's languages that the app's localizations list. Keys are the English text.
// Raises NSInternalInconsistencyException for a key Spark does not define.
FOUNDATION_EXPORT NSString *SparkLocalizedString(NSString *key);
// Retitles the desktop template's main menu (Main.storyboard) in that language and puts `name` in the
// app menu, its About, Hide and Quit items and the Help item. Call in applicationWillFinishLaunching:.
FOUNDATION_EXPORT void SparkLocalizeMainMenu(NSString *name);
// getAppLanguages(): { supported, current, override, framework }.
FOUNDATION_EXPORT NSDictionary *SparkAppLanguages(void);
// Stores the per-app language for later launches (AppleLanguages in the app's own defaults, as System
// Settings does); nil follows the system again. NO for a language the app does not list.
FOUNDATION_EXPORT BOOL SparkSetAppLanguage(NSString *language);
