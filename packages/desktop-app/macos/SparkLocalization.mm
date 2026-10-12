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

// Every template title is a key (tests/framework-strings.test.ts); the app-name titles are set below.
static void Retitle(NSMenu *menu) {
  menu.title = Lookup(menu.title) ?: menu.title;
  for (NSMenuItem *item in menu.itemArray) {
    if (item.separatorItem) continue;
    item.title = Lookup(item.title) ?: item.title;
    if (item.submenu) Retitle(item.submenu);
  }
}
void SparkLocalizeMainMenu(NSString *name) {
  NSMenu *main = NSApp.mainMenu;
  Retitle(main);
  NSMenuItem *application = main.itemArray.firstObject;
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
NSDictionary *SparkAppLanguages(void) {
  NSBundle *main = NSBundle.mainBundle;
  // The app's own domain: launch arguments (-AppleLanguages) and the global domain do not count.
  id stored = [[NSUserDefaults.standardUserDefaults persistentDomainForName:main.bundleIdentifier] objectForKey:@"AppleLanguages"];
  id first = [stored isKindOfClass:NSArray.class] ? [stored firstObject] : nil;
  return @{
    @"supported": Localizations(main),
    @"current": main.preferredLocalizations.firstObject ?: main.developmentLocalization,
    @"override": [first isKindOfClass:NSString.class] ? first : NSNull.null,
    @"framework": Localizations(SparkStrings()),
  };
}
BOOL SparkSetAppLanguage(NSString *language) {
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  if (!language) { [defaults removeObjectForKey:@"AppleLanguages"]; return YES; }
  if (![Localizations(NSBundle.mainBundle) containsObject:language]) return NO;
  [defaults setObject:@[language] forKey:@"AppleLanguages"];
  return YES;
}
