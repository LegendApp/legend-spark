import { useState } from "react";
import { ScrollView, Text } from "react-native";
import * as Localize from "react-native-localize";

// Test IDs: internationalization-localize-passed, or -failed with the failing values.
const ID = "internationalization-localize";

function read() {
  const locales = Localize.getLocales();
  const values = { locales, currencies: Localize.getCurrencies(), country: Localize.getCountry(), timeZone: Localize.getTimeZone(), calendar: Localize.getCalendar(), temperatureUnit: Localize.getTemperatureUnit(), uses24HourClock: Localize.uses24HourClock(), usesMetricSystem: Localize.usesMetricSystem(), numberFormat: Localize.getNumberFormatSettings(), best: Localize.findBestLanguageTag(["en", "ar", "fr"]) };
  const failures = [
    (!locales.length || !locales[0].languageTag || typeof locales[0].isRTL !== "boolean") && "locales",
    !/^[A-Z]{2}$/.test(values.country) && "country",
    !values.timeZone.includes("/") && values.timeZone !== "UTC" && "time zone",
    !values.currencies.every(code => /^[A-Z]{3}$/.test(code)) && "currencies",
    !["celsius", "fahrenheit"].includes(values.temperatureUnit) && "temperature unit",
    (!values.numberFormat.decimalSeparator) && "number format",
  ].filter(Boolean);
  return { values, failures };
}

/** react-native-localize: the user's locales, region, time zone and number format from macOS settings. */
export function LocalizeDemo() {
  const [{ values, failures }] = useState(read);
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-6">
    <Text selectable className="font-mono text-xs text-foreground" testID={`${ID}-${failures.length ? "failed" : "passed"}`}>{failures.length ? `failed: ${failures.join(", ")}` : "passed"}</Text>
    <Text selectable className="font-mono text-xs text-foreground">{JSON.stringify(values, null, 2)}</Text>
  </ScrollView>;
}
