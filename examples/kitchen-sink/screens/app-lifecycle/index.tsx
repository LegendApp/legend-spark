import { defineScreens } from "../../shell/registry";
import { LaunchInstance } from "./LaunchInstance";

export default defineScreens("app-lifecycle", [
  { id: "launch", title: "Launch & single instance", summary: "Single-instance status, forwarded second launches (arguments, files, URLs), relaunch with a quit veto, and safe mode.", component: LaunchInstance },
]);
