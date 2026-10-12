import { defineScreens } from "../../shell/registry";
import { Biometrics } from "./Biometrics";

export default defineScreens("storage-data", [
  { id: "biometrics", title: "Biometrics", summary: "Touch ID availability and status, prompts with each fallback policy (Touch ID only, the login password, the app's own sign-in), cancelling a prompt, and Keychain secrets gated by biometry.", component: Biometrics },
]);
