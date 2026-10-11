import { defineScreens } from "../../shell/registry";
import { ScrollDirection } from "./ScrollDirection";
import { TextAlignment } from "./TextAlignment";

export default defineScreens("internationalization", [
  { id: "scroll-direction", title: "Scroll direction", summary: "A horizontal ScrollView: it starts at the leading edge, and its content reads correctly in right-to-left locales.", component: ScrollDirection },
  { id: "text-alignment", title: "Text alignment", summary: "Text in full-width boxes with each textAlign: the default and auto start at the leading edge in right-to-left locales.", component: TextAlignment },
]);
