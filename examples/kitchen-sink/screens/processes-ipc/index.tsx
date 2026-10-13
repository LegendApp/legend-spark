import { defineScreens } from "../../shell/registry";
import { PrivilegedHelper } from "./PrivilegedHelper";
import { PRIVILEGED_HELPER_MESSAGES } from "./privileged-helper-messages";

export default defineScreens("processes-ipc", [
  { id: "privileged-helper", title: "Privileged helper, admin prompt and XPC", titles: { ar: PRIVILEGED_HELPER_MESSAGES.ar.title }, summary: "A launch daemon registered through SMAppService with its approval states, the system admin prompt and its rights checked by the helper, XPC messages where each side checks the other's code signature, and availability that reports an unsigned build truthfully.", component: PrivilegedHelper },
]);
