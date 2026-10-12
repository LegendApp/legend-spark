import { useCallback, useEffect, useRef, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import {
  BiometricError, authenticateWithBiometrics, deleteBiometricSecret, getBiometricAvailability, getBiometricSecret, getBiometricStatus, setBiometricSecret,
  type BiometricFallback, type BiometricSecretAccess, type BiometricStatus,
} from "@legendapp/spark/biometrics";

export const FALLBACKS: readonly BiometricFallback[] = ["none", "password", "app"];
export const ACCESSES: readonly BiometricSecretAccess[] = ["biometryCurrentSet", "biometryAny", "biometryOrPassword"];
/** The prompt's reason; API data, so flows can assert it in any locale. */
export const REASON = "unlock the Kitchen Sink demo";
/** Each access stores its secret under its own name. */
const secretValue = (access: BiometricSecretAccess) => `secret for ${access}`;
/** "touchId · biometrics available · password available". */
const describeStatus = (status: BiometricStatus) => `${status.biometryType} · biometrics ${status.biometrics} · password ${status.password}`;
/** Results show codes and reasons only, so flows can assert them in any locale. */
const describeFailure = (cause: unknown) =>
  cause instanceof BiometricError ? `BiometricError:${cause.code}:${cause.reason}` : cause instanceof SparkError ? `SparkError:${cause.code}` : String(cause);
export type SecretAction = "store" | "read" | "delete";

/**
 * Status, prompts and secrets through @legendapp/spark/biometrics. Opening the screen only reads the status, which never
 * prompts; nothing prompts until a button is pressed. In a test-driver run every call goes to the simulated state
 * (docs/biometrics.md#testing), so no Touch ID or password prompt appears and no keychain is touched.
 */
export function useBiometricsDemo() {
  const [status, setStatus] = useState<string>();
  const [authResult, setAuthResult] = useState<string>();
  const [secretResults, setSecretResults] = useState<Partial<Record<BiometricSecretAccess, string>>>({});
  const [prompting, setPrompting] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => getBiometricStatus().then(describeStatus, describeFailure).then(setStatus), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const authenticate = useCallback(async (fallback: BiometricFallback) => {
    // A second prompt while one is up rejects E_BUSY; Cancel keeps aborting the first.
    const controller = new AbortController();
    if (!abort.current) { abort.current = controller; setPrompting(true); setAuthResult(undefined); }
    let result: string;
    try {
      const answer = await authenticateWithBiometrics({ reason: REASON, fallback, signal: controller.signal, ...(fallback === "app" ? { fallbackLabel: "Use account password" } : {}) });
      result = answer.success ? `${fallback}: success` : `${fallback}: ${answer.reason}`;
    } catch (cause) { result = `${fallback}: ${describeFailure(cause)}`; }
    if (abort.current === controller) { abort.current = undefined; setPrompting(false); }
    setAuthResult(result);
    void refresh();
  }, [refresh]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const secret = useCallback(async (access: BiometricSecretAccess, action: SecretAction) => {
    let result: string;
    try {
      if (action === "store") { await setBiometricSecret(access, secretValue(access), { access }); result = "stored"; }
      else if (action === "delete") { await deleteBiometricSecret(access); result = "deleted"; }
      else {
        const read = await getBiometricSecret(access, { reason: REASON });
        result = read.success ? `value: ${read.value ?? "null"}` : read.reason;
      }
    } catch (cause) { result = describeFailure(cause); }
    setSecretResults(current => ({ ...current, [access]: result }));
    void refresh();
  }, [refresh]);

  return { availability: getBiometricAvailability(), status, authResult, secretResults, prompting, refresh, authenticate, cancel, secret };
}
