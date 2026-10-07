import { spawnProcess } from "./process.ts";
import { readAppConfig } from "./project.ts";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { run } from "./commands.ts";
import { readJson, stateFile, writeJson } from "./project.ts";
import { listNotaryProfiles } from "./notary-profiles.ts";

export type SigningIdentity = { hash: string; name: string; teamId: string };
export type SigningCredentials = SigningIdentity & { keychainProfile: string; keychain?: string };
export type Runner = typeof run;

export function parseIdentities(output: string): SigningIdentity[] {
  return [...output.matchAll(/\b([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"\n]+ \(([A-Z0-9]{10})\))"/g)]
    .map((match) => ({ hash: match[1]!.toUpperCase(), name: match[2]!, teamId: match[3]! }));
}

export function chooseIdentity(identities: SigningIdentity[], identity?: string, teamId?: string) {
  const matches = identities.filter((item) => (!identity || item.hash === identity.toUpperCase() || item.name === identity) && (!teamId || item.teamId === teamId));
  if (!matches.length) throw new Error("No matching Developer ID Application identity with a private key is available. Install it through Xcode or Keychain Access, then run spark credentials.");
  return matches;
}

export function notaryAuth(credentials: SigningCredentials) {
  return ["--keychain-profile", credentials.keychainProfile, ...(credentials.keychain ? ["--keychain", credentials.keychain] : [])];
}

async function ask(question: string) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(question)).trim(); }
  finally { input.close(); }
}

export async function credentials(root: string, reset = false, execute: Runner = run): Promise<SigningCredentials> {
  const file = stateFile(root, "signing.json");
  const saved = !reset && existsSync(file) ? readJson(file) : {};
  const config = readAppConfig(root).expo?.extra?.spark?.signing?.macos ?? {};
  const keychain = process.env.SPARK_SIGNING_KEYCHAIN ?? saved.keychain;
  const identity = process.env.SPARK_DEVELOPER_ID_APPLICATION ?? config.identity ?? (process.stdin.isTTY ? undefined : saved.hash);
  const teamId = process.env.SPARK_TEAM_ID ?? config.teamId ?? (process.stdin.isTTY ? undefined : saved.teamId);
  const discovered = parseIdentities(await execute(root, ["security", "find-identity", "-v", "-p", "codesigning", ...(keychain ? [keychain] : [])], { capture: true }));
  const matches = chooseIdentity(discovered, identity, teamId);
  const defaultChoice = Math.max(0, matches.findIndex(item => item.hash === saved.hash)) + 1;
  let selected = matches[defaultChoice - 1]!;
  if (process.stdin.isTTY) {
    console.log("Available Developer ID signing certificates:");
    console.log(matches.map((item, index) => `${index + 1}. ${item.name} [${item.hash}]`).join("\n"));
    const choice = Number(await ask(`Signing certificate [${defaultChoice}]: `) || String(defaultChoice));
    if (!Number.isInteger(choice) || choice < 1 || choice > matches.length) throw new Error("Invalid signing identity selection.");
    selected = matches[choice - 1]!;
  } else if (matches.length > 1) {
    throw new Error("Multiple signing identities are available. Set SPARK_DEVELOPER_ID_APPLICATION or run spark credentials interactively.");
  }
  let keychainProfile = process.env.SPARK_NOTARY_KEYCHAIN_PROFILE ?? saved.keychainProfile;
  let suggestedProfile = keychainProfile || `spark-${selected.teamId}`;
  let result!: SigningCredentials;
  let validated = false;
  let needsSelection = Boolean(process.stdin.isTTY);
  while (!validated) {
    if (needsSelection || !keychainProfile) {
      if (!process.stdin.isTTY) throw new Error("Notarization is not configured. Set SPARK_NOTARY_KEYCHAIN_PROFILE or run spark credentials interactively.");
      const profiles = await listNotaryProfiles(root, keychain, execute);
      const manualChoice = profiles.length + 1;
      const createChoice = profiles.length + 2;
      const rememberedChoice = profiles.indexOf(keychainProfile);
      const defaultProfileChoice = rememberedChoice >= 0 ? rememberedChoice + 1 : profiles.length ? 1 : manualChoice;
      console.log(`Available saved notarization Keychain profiles${keychain ? ` in ${keychain}` : ""}:`);
      console.log(profiles.length ? profiles.map((profile, index) => `${index + 1}. ${profile}`).join("\n") : "No saved notarization profiles found.");
      console.log(`${manualChoice}. Enter an existing profile name\n${createChoice}. Create a notarization Keychain profile`);
      const choice = Number(await ask(`Notarization profile [${defaultProfileChoice}]: `) || String(defaultProfileChoice));
      if (Number.isInteger(choice) && choice >= 1 && choice <= profiles.length) {
        keychainProfile = profiles[choice - 1]!;
      } else if (choice === manualChoice) {
        keychainProfile = await ask("Existing notarization Keychain profile: ");
        if (!keychainProfile) throw new Error("Enter an existing profile name or select the create option.");
      } else if (choice === createChoice) {
        keychainProfile = await ask(`New notarization Keychain profile [${suggestedProfile}]: `) || suggestedProfile;
        console.log(`Apple’s tool will store and validate notarization credentials in Keychain as ${keychainProfile}. Secret input is handled by notarytool and is not recorded by spark.`);
        const child = spawnProcess(["xcrun", "notarytool", "store-credentials", keychainProfile, ...(keychain ? ["--keychain", keychain] : [])], {
          stdin: "inherit", stdout: "inherit", stderr: "inherit",
        });
        if (await child.exited) throw new Error("Notarization credential setup failed. Run spark credentials to retry.");
      } else {
        throw new Error("Invalid notarization setup selection.");
      }
      needsSelection = false;
    }
    result = { ...selected, keychainProfile, ...(keychain ? { keychain } : {}) };
    // Validate the Keychain profile before native compilation or signing.
    try {
      await execute(root, ["xcrun", "notarytool", "history", ...notaryAuth(result), "--output-format", "json"], { capture: true });
      validated = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("No Keychain password item found for profile:")) {
        const message = `Notarization Keychain profile ${JSON.stringify(keychainProfile)} was not found${keychain ? ` in ${JSON.stringify(keychain)}` : ""}. A signing certificate name does not create a notarization profile.`;
        if (!process.stdin.isTTY) throw new Error(`${message} Run spark credentials interactively to select an existing profile or explicitly create one.`, { cause: error });
        console.error(message);
        suggestedProfile = keychainProfile;
        keychainProfile = undefined;
        needsSelection = true;
      } else {
        throw error;
      }
    }
  }
  writeJson(file, result);
  return result;
}
