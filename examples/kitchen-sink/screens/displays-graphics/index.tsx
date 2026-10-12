import { defineScreens } from "../../shell/registry";
import { Displays } from "./Displays";

export default defineScreens("displays-graphics", [
  { id: "displays", title: "Displays", summary: "Every display's arrangement, work area, scale, notch safe area, refresh rate (fixed or variable), color space and EDR headroom, with the change events @legendapp/spark/displays reports while the screen is open.", component: Displays },
]);
