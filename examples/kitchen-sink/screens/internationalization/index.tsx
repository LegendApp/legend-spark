import { defineScreens } from "../../shell/registry";
import { ScrollDirection } from "./ScrollDirection";

export default defineScreens("internationalization", [
  { id: "scroll-direction", title: "Scroll direction", summary: "A horizontal ScrollView: it starts at the leading edge, and its content reads correctly in right-to-left locales.", component: ScrollDirection },
]);
