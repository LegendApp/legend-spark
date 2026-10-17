import { createElement } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { SparkError, invokeNative, parseNativeResult } from "@legendapp/spark-desktop-app/src/contracts";
import DesktopAppleSignInButton from "./DesktopAppleSignInButtonNativeComponent";
import { appleIdRequest, availability, checkOptions, isAppleIDCredential, isRecord, perform, requireNative, text, failure, type AuthorizationAvailability } from "./shared";
export { AuthorizationError, type AuthorizationAvailability, type AuthorizationErrorReason } from "./shared";
export type { Availability } from "@legendapp/spark-desktop-app/src/contracts";

/** Information Sign in with Apple can ask the person to share. */
export type AppleAuthenticationScope = "fullName" | "email";
/** What Sign in with Apple asks for: in `signInWithApple`, and in a combined `getCredential` (`/passkeys`). */
export interface AppleIDRequest {
  /** What to ask the person to share. Apple returns them only the first time the person signs in to the app. */
  scopes?: AppleAuthenticationScope[];
  /** Returned unchanged in the credential, to match the response to the request. 1–1024 characters. */
  state?: string;
  /**
   * Replay protection. Pass the SHA-256 (hex) of a fresh random raw nonce, never the raw value; Apple embeds it in the
   * identity token. Send the raw nonce to your server, which checks the token's nonce claim equals its SHA-256
   * (docs/authentication.md#verifying-on-your-server). 1–1024 characters.
   */
  nonce?: string;
}
/** Options for `signInWithApple`. */
export interface AppleSignInOptions extends AppleIDRequest {
  /** The window to present over (useWindowId(); "main" for the main window). Default: the key window. */
  windowId?: string;
  /** Aborting cancels the sheet and rejects E_ABORTED with reason `appCancel`. */
  signal?: AbortSignal;
}
/** Name parts the person shared through the `fullName` scope; each is null when not given. */
export interface AppleIDFullName {
  namePrefix: string | null; givenName: string | null; middleName: string | null;
  familyName: string | null; nameSuffix: string | null; nickname: string | null;
}
/** The credential a successful `signInWithApple` returns. */
export interface AppleIDCredential {
  /** Stable for this person and your team: the account identifier to store. */
  user: string;
  state: string | null;
  authorizedScopes: AppleAuthenticationScope[];
  /** A JSON Web Token for your server to verify with Apple. */
  identityToken: string | null;
  /** A short-lived code for your server to exchange with Apple. */
  authorizationCode: string | null;
  /** First sign-in with the email scope only; may be a private relay address. */
  email: string | null;
  /** First sign-in with the fullName scope only. */
  fullName: AppleIDFullName | null;
  realUserStatus: "likelyReal" | "unknown" | "unsupported";
}
/** Result of `signInWithApple`: the credential, or `cancel` when the person cancels. */
export type AppleSignInResult = { type: "success"; credential: AppleIDCredential } | { type: "cancel" };
/** Result of `getAppleIDCredentialState`: whether the Apple ID is still `authorized` for this app. */
export type AppleIDCredentialState = "authorized" | "revoked" | "notFound" | "transferred";

const STATES: readonly AppleIDCredentialState[] = ["authorized", "revoked", "notFound", "transferred"];

/**
 * macOS only; Windows reports `unsupported-platform` (#423). `missing-entitlement` until the app is built with
 * `macos.authentication.signInWithApple` and signed by its team with a provisioning profile (docs/authentication.md).
 */
export function getAppleAuthenticationAvailability(): AuthorizationAvailability { return availability("appleId"); }

/**
 * Shows the Sign in with Apple sheet over the window. Resolves the credential, or `{ type: "cancel" }` when the person
 * cancels; rejects an AuthorizationError (missingEntitlement before anything shows, or AuthenticationServices' failure),
 * E_BUSY while another authorization request is showing and E_NOT_FOUND without a window. Call it from a person's action.
 */
export async function signInWithApple(options: AppleSignInOptions = {}): Promise<AppleSignInResult> {
  const checked = checkOptions(options, ["scopes", "state", "nonce", "windowId", "signal"]);
  return perform("appleId", appleIdRequest(checked), checked, isAppleIDCredential);
}

/**
 * Whether the Apple ID `user` (from a credential) is still authorized for this app. Apple's servers answer; call it at
 * launch and sign the person out when it is not `authorized`. Rejects missingEntitlement like signInWithApple.
 */
export async function getAppleIDCredentialState(user: string): Promise<AppleIDCredentialState> {
  if (!text(user, 1024)) throw new SparkError("E_INVALID_ARGUMENT", "user is the credential's user identifier, 1–1024 characters");
  const native = requireNative();
  const value = parseNativeResult(await invokeNative(() => native.call("credentialState", JSON.stringify({ user }))), (result): result is AppleIDCredentialState | { type: "failure"; reason: string; message: string } =>
    STATES.includes(result as AppleIDCredentialState) || (isRecord(result) && result.type === "failure" && typeof result.reason === "string" && typeof result.message === "string"));
  return typeof value === "string" ? value : failure(value.reason, value.message);
}

/** The button's title, in the app's language: Sign in with Apple, Continue with Apple or Sign up with Apple. */
export type AppleSignInButtonType = "signIn" | "continue" | "signUp";
/**
 * The button's colors (Apple's HIG). `automatic` (the default) is black on a light appearance and white on a dark one,
 * following the window's appearance; `whiteOutline` is for white or light backgrounds where plain white would vanish.
 */
export type AppleSignInButtonStyle = "automatic" | "black" | "white" | "whiteOutline";
/** What a press of `AppleSignInButton` passes to `onPress`. */
export interface AppleSignInButtonPressEvent {
  /** The button's window, for `signInWithApple({ windowId })`; undefined in a window Spark did not make. */
  windowId: string | undefined;
}
interface AppleSignInButtonBaseProps extends ViewProps {
  /** Default `signIn`. */
  buttonType?: AppleSignInButtonType;
  /** Default `automatic`. */
  buttonStyle?: AppleSignInButtonStyle;
  /** In points, 0 or more. Default: the system's. */
  cornerRadius?: number;
}
interface AppleSignInButtonPressProps extends AppleSignInButtonBaseProps {
  /** The app handles the press, typically with `signInWithApple({ windowId, ... })` and its own signal. */
  onPress: (event: AppleSignInButtonPressEvent) => void;
  signInOptions?: never; onSignIn?: never; onError?: never;
}
interface AppleSignInButtonRequestProps extends AppleSignInButtonBaseProps {
  onPress?: never;
  /** Passed to `signInWithApple` on each press. Default `windowId`: the button's window. */
  signInOptions?: AppleSignInOptions;
  /** The request's result: the credential, or cancel. */
  onSignIn: (result: AppleSignInResult) => void;
  /** The request's rejection (an AuthorizationError, or a SparkError for invalid options or another request showing). */
  onError: (error: unknown) => void;
}
/**
 * Props for `AppleSignInButton`: either `onPress`, or `onSignIn` and `onError` (with optional `signInOptions`) for the
 * button to run `signInWithApple` itself. Size it with `style`; the default is Apple's minimum, 140 × 30 points.
 */
export type AppleSignInButtonProps = AppleSignInButtonPressProps | AppleSignInButtonRequestProps;

const BUTTON_TYPES: readonly AppleSignInButtonType[] = ["signIn", "continue", "signUp"];
const BUTTON_STYLES: readonly AppleSignInButtonStyle[] = ["automatic", "black", "white", "whiteOutline"];
const MINIMUM_SIZE = { minWidth: 140, minHeight: 30 };

/**
 * Apple's Sign in with Apple button (ASAuthorizationAppleIDButton), which apps that offer Sign in with Apple must use.
 * Apple draws the logo and the localized title, right to left where the app's language is. Shows whatever the
 * availability: a press without the entitlement rejects missingEntitlement, so check `getAppleAuthenticationAvailability`
 * to decide whether to show it. macOS only: rendering it elsewhere throws E_UNSUPPORTED_PLATFORM (#423), and without
 * NativeDesktopAuthentication E_MODULE_UNAVAILABLE; invalid props throw E_INVALID_ARGUMENT.
 */
export function AppleSignInButton({ buttonType = "signIn", buttonStyle = "automatic", cornerRadius, onPress, signInOptions, onSignIn, onError, style, ...props }: AppleSignInButtonProps) {
  requireNative();
  if (!BUTTON_TYPES.includes(buttonType)) throw new SparkError("E_INVALID_ARGUMENT", "buttonType is signIn, continue or signUp");
  if (!BUTTON_STYLES.includes(buttonStyle)) throw new SparkError("E_INVALID_ARGUMENT", "buttonStyle is automatic, black, white or whiteOutline");
  if (cornerRadius !== undefined && !(Number.isFinite(cornerRadius) && cornerRadius >= 0)) throw new SparkError("E_INVALID_ARGUMENT", "cornerRadius is 0 or more points");
  const pressMode = typeof onPress === "function" && onSignIn === undefined && onError === undefined && signInOptions === undefined;
  if (!pressMode && !(onPress === undefined && typeof onSignIn === "function" && typeof onError === "function")) throw new SparkError("E_INVALID_ARGUMENT", "AppleSignInButton takes onPress, or onSignIn and onError");
  const pressed = ({ nativeEvent }: NativeSyntheticEvent<{ windowId: string }>) => {
    const windowId = nativeEvent.windowId || undefined;
    if (pressMode) onPress!({ windowId });
    else signInWithApple({ windowId, ...signInOptions }).then(onSignIn, onError);
  };
  return createElement(DesktopAppleSignInButton, { ...props, style: [MINIMUM_SIZE, style], buttonType, buttonStyle, cornerRadius: cornerRadius ?? -1, onButtonPress: pressed });
}
