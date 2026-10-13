import { defineScreens } from "../../shell/registry";
import { Displays } from "./Displays";

export default defineScreens("displays-graphics", [
  { id: "displays", title: "Displays", titles: { ar: "الشاشات" }, summary: "Every display's arrangement, work area, scale, notch safe area, refresh rate (fixed or variable), color space and EDR headroom, with the change events @legendapp/spark/displays reports while the screen is open.", summaries: { ar: "ترتيب كل شاشة ومساحة عملها وتكبيرها ومنطقتها الآمنة حول الشق ومعدل تحديثها (ثابت أو متغيّر) وفضاء ألوانها وهامش EDR، مع أحداث التغيير التي يُبلغ عنها @legendapp/spark/displays ما دامت هذه الشاشة مفتوحة." }, component: Displays },
]);
