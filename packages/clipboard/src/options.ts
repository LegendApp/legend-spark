import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { StringFormat } from "./formats";
export function stringOptions(options: object, key: string): StringFormat {
  if (!options || typeof options !== "object" || Object.keys(options).some(name => name !== key)) throw new SparkError("E_UNSUPPORTED_OPTION", "Unsupported clipboard option");
  const format = (options as Record<string, unknown>)[key] ?? StringFormat.PLAIN_TEXT;
  if (format !== StringFormat.PLAIN_TEXT && format !== StringFormat.HTML) throw new SparkError("E_INVALID_ARGUMENT", "Invalid clipboard string format");
  return format;
}
