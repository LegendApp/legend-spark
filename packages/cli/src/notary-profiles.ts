import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "./commands.ts";
import { stateFile } from "./project.ts";

// Security returns attributes only. Never request or print credential data.
const discovery = String.raw`
import Foundation
import Security
import LocalAuthentication

struct KeychainError: Error { let status: OSStatus }
func check(_ status: OSStatus) throws {
    if status != errSecSuccess { throw KeychainError(status: status) }
}
func profiles(_ query: [CFString: Any]) throws -> [String] {
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    var names: [String] = []
    if status != errSecItemNotFound {
        try check(status)
        let prefix = "com.apple.gke.notary.tool.saved-creds."
        for item in result as? [[String: Any]] ?? [] {
            if let account = item[kSecAttrAccount as String] as? String, account.hasPrefix(prefix) {
                let name = String(account.dropFirst(prefix.count))
                if !name.isEmpty { names.append(name) }
            }
        }
    }
    return names
}

do {
    let context = LAContext()
    context.interactionNotAllowed = true
    var query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrLabel: "com.apple.gke.notary.tool",
        kSecMatchLimit: kSecMatchLimitAll,
        kSecReturnAttributes: true,
        kSecReturnData: false,
        kSecUseAuthenticationContext: context
    ]
    if CommandLine.arguments.count > 1 {
        var keychain: SecKeychain?
        try check(SecKeychainOpen(CommandLine.arguments[1], &keychain))
        if let keychain { query[kSecMatchSearchList] = [keychain] }
    }
    var names = try profiles(query)
    if CommandLine.arguments.count == 1 {
        query[kSecUseDataProtectionKeychain] = true
        query[kSecAttrSynchronizable] = kSecAttrSynchronizableAny
        names += try profiles(query)
    }
    let data = try JSONSerialization.data(withJSONObject: Array(Set(names)).sorted())
    print(String(decoding: data, as: UTF8.self))
} catch {
    let message: String
    if let error = error as? KeychainError {
        message = SecCopyErrorMessageString(error.status, nil) as String? ?? "OSStatus \(error.status)"
    } else { message = String(describing: error) }
    FileHandle.standardError.write(Data("Cannot list notarization Keychain profiles: \(message)\n".utf8))
    exit(1)
}
`;

export async function listNotaryProfiles(root: string, keychain?: string, execute: typeof run = run): Promise<string[]> {
  const file = stateFile(root, "notary-profiles.swift");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, discovery);
  const output = await execute(root, ["xcrun", "swift", "-suppress-warnings", file, ...(keychain ? [keychain] : [])], { capture: true });
  const profiles: unknown = JSON.parse(output);
  if (!Array.isArray(profiles) || !profiles.every(profile => typeof profile === "string" && profile.length > 0)) {
    throw new Error("Invalid notarization profile discovery result.");
  }
  return [...new Set(profiles)].sort();
}
