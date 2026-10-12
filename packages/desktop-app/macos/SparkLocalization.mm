#import "SparkLocalization.h"

@interface SparkLocalizationAnchor : NSObject
@end
@implementation SparkLocalizationAnchor
@end

static NSString *const SparkMissing = @"\u0000spark-missing";

// A static pod's resource bundle sits in the app's Resources; a framework pod's in the framework.
static NSBundle *SparkStrings(void) {
  static NSBundle *bundle;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSURL *url = [[NSBundle bundleForClass:SparkLocalizationAnchor.class] URLForResource:@"SparkStrings" withExtension:@"bundle"];
    bundle = url ? [NSBundle bundleWithURL:url] : nil;
  });
  if (!bundle) [NSException raise:NSInternalInconsistencyException format:@"This build is missing Spark's SparkStrings resource bundle"];
  return bundle;
}
static NSString *Lookup(NSString *key) {
  NSString *value = [SparkStrings() localizedStringForKey:key value:SparkMissing table:@"Spark"];
  return [value isEqualToString:SparkMissing] ? nil : value;
}
NSString *SparkLocalizedString(NSString *key) {
  NSString *value = Lookup(key);
  if (!value) [NSException raise:NSInternalInconsistencyException format:@"Spark has no native string \"%@\"", key];
  return value;
}

// The app menu's title and its About, Hide, Quit and Help items carry the app name (set below).
static BOOL Named(NSMenuItem *item) {
  SEL action = item.action;
  return action == @selector(orderFrontStandardAboutPanel:) || action == @selector(hide:) || action == @selector(terminate:) || action == @selector(showHelp:);
}
// Every template title is a key (tests/framework-strings.test.ts). A title without one stays as it is; a debug
// build logs it, so a changed template does not leave an English item unnoticed.
static NSString *Translate(NSString *title) {
  NSString *value = Lookup(title);
#if DEBUG
  if (!value && title.length) NSLog(@"Spark: no native string for the menu title \"%@\"; it stays untranslated", title);
#endif
  return value ?: title;
}
static void Retitle(NSMenu *menu, NSMenuItem *application) {
  if (menu != application.submenu) menu.title = Translate(menu.title);
  for (NSMenuItem *item in menu.itemArray) {
    if (item.separatorItem) continue;
    if (item != application && !Named(item)) item.title = Translate(item.title);
    if (item.submenu) Retitle(item.submenu, application);
  }
}
void SparkLocalizeMainMenu(NSString *name) {
  NSMenu *main = NSApp.mainMenu;
  NSMenuItem *application = main.itemArray.firstObject;
  Retitle(main, application);
  application.title = name;
  application.submenu.title = name;
  for (NSMenuItem *item in application.submenu.itemArray) {
    if (item.isAlternate) continue;
    SEL action = item.action;
    NSString *format = action == @selector(orderFrontStandardAboutPanel:) ? @"About %@" : action == @selector(hide:) ? @"Hide %@" : action == @selector(terminate:) ? @"Quit %@" : nil;
    if (format) item.title = [NSString stringWithFormat:SparkLocalizedString(format), name];
  }
  for (NSMenuItem *item in NSApp.helpMenu.itemArray)
    if (item.action == @selector(showHelp:)) item.title = [NSString stringWithFormat:SparkLocalizedString(@"%@ Help"), name];
}

static NSArray<NSString *> *Localizations(NSBundle *bundle) {
  NSMutableOrderedSet<NSString *> *languages = [NSMutableOrderedSet orderedSetWithArray:bundle.localizations];
  [languages removeObject:@"Base"];
  return languages.array;
}
// The languages the app declares (`localizations`: CFBundleLocalizations) that the bundle resolves; a stray .lproj
// folder adds none. Without a declaration, the development language.
static NSArray<NSString *> *Supported(void) {
  NSBundle *main = NSBundle.mainBundle;
  id declared = [main objectForInfoDictionaryKey:@"CFBundleLocalizations"];
  NSArray *languages = [declared isKindOfClass:NSArray.class] ? declared : main.developmentLocalization ? @[main.developmentLocalization] : @[];
  NSArray *resolved = Localizations(main);
  return [languages filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(id language, NSDictionary *bindings) { return [language isKindOfClass:NSString.class] && [resolved containsObject:language]; }]];
}
NSDictionary *SparkAppLanguages(void) {
  NSBundle *main = NSBundle.mainBundle;
  // The app's own domain: launch arguments (-AppleLanguages) and the global domain do not count.
  id stored = [[NSUserDefaults.standardUserDefaults persistentDomainForName:main.bundleIdentifier] objectForKey:@"AppleLanguages"];
  id first = [stored isKindOfClass:NSArray.class] ? [stored firstObject] : nil;
  return @{
    @"supported": Supported(),
    @"current": main.preferredLocalizations.firstObject ?: main.developmentLocalization,
    @"override": [first isKindOfClass:NSString.class] ? first : NSNull.null,
    @"framework": Localizations(SparkStrings()),
  };
}
BOOL SparkSetAppLanguage(NSString *language) {
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  if (!language) { [defaults removeObjectForKey:@"AppleLanguages"]; return YES; }
  if (![Supported() containsObject:language]) return NO;
  [defaults setObject:@[language] forKey:@"AppleLanguages"];
  return YES;
}
