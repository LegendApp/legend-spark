import { defineScreens } from "../../shell/registry";
import { SignIn } from "./SignIn";
import { SIGN_IN_MESSAGES } from "./sign-in-messages";

export default defineScreens("authentication", [
  { id: "sign-in", title: "Sign in with Apple and passkeys", titles: { ar: SIGN_IN_MESSAGES.ar.title }, summary: "Sign in with Apple and the Apple ID credential state, passkey registration and assertion over the calling window, cancelling a request, and availability that reports a missing entitlement truthfully.", component: SignIn },
]);
