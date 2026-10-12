import { defineScreens } from "../../shell/registry";
import { NativeStrings } from "./NativeStrings";
import { ScrollDirection } from "./ScrollDirection";
import { TextAlignment } from "./TextAlignment";

export default defineScreens("internationalization", [
  { id: "native-strings", title: "Native strings", summary: "The app's languages and per-app language: menus, dialog buttons and AppKit panels use the current one, including Spark's own strings.", component: NativeStrings },
  { id: "scroll-direction", title: "Scroll direction", summary: "A horizontal ScrollView: it starts at the leading edge, and its content reads correctly in right-to-left locales.", component: ScrollDirection },
  { id: "text-alignment", title: "Text alignment", summary: "Text in full-width boxes with each textAlign: the default and auto start at the leading edge in right-to-left locales.", component: TextAlignment },
]);
