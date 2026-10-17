import AuthenticationServices
import Foundation

// WebAuthn credential-management signals for SparkAuthorization.mm, which reaches this class by name: AuthenticationServices
// offers them to Swift only. ASCredentialDataManager on macOS 26.2 and later; ASCredentialUpdater, which it replaces, on
// 26.0 and 26.1. SparkAuthorization calls it after checking the arguments and the webcredentials entitlement, and never
// from a simulated (test-driver) instance.
@objc(SparkCredentialSignals) final class SparkCredentialSignals: NSObject {
  /// Whether this build and this macOS have the signals (built with the macOS 26 SDK, running macOS 26).
  @objc static var supported: Bool {
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) { return true }
    #endif
    return false
  }

  @objc(reportUnknownCredential:credentialID:completion:)
  static func reportUnknownCredential(_ relyingParty: String, credentialID: Data, completion: @escaping @Sendable (Error?) -> Void) {
    #if compiler(>=6.2.3)
    if #available(macOS 26.2, *) {
      return run(completion) { try await ASCredentialDataManager().reportUnknownPublicKeyCredential(relyingPartyIdentifier: relyingParty, credentialID: credentialID) }
    }
    #endif
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      return run(completion) { try await ASCredentialUpdater().reportUnknownPublicKeyCredential(relyingPartyIdentifier: relyingParty, credentialID: credentialID) }
    }
    #endif
    completion(unsupported)
  }

  @objc(reportAllAcceptedCredentials:userHandle:acceptedCredentialIDs:completion:)
  static func reportAllAcceptedCredentials(_ relyingParty: String, userHandle: Data, acceptedCredentialIDs: [Data], completion: @escaping @Sendable (Error?) -> Void) {
    #if compiler(>=6.2.3)
    if #available(macOS 26.2, *) {
      return run(completion) { try await ASCredentialDataManager().reportAllAcceptedPublicKeyCredentials(relyingPartyIdentifier: relyingParty, userHandle: userHandle, acceptedCredentialIDs: acceptedCredentialIDs) }
    }
    #endif
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      return run(completion) { try await ASCredentialUpdater().reportAllAcceptedPublicKeyCredentials(relyingPartyIdentifier: relyingParty, userHandle: userHandle, acceptedCredentialIDs: acceptedCredentialIDs) }
    }
    #endif
    completion(unsupported)
  }

  @objc(reportCurrentUserDetails:userHandle:name:completion:)
  static func reportCurrentUserDetails(_ relyingParty: String, userHandle: Data, name: String, completion: @escaping @Sendable (Error?) -> Void) {
    #if compiler(>=6.2.3)
    if #available(macOS 26.2, *) {
      return run(completion) { try await ASCredentialDataManager().reportPublicKeyCredentialUpdate(relyingPartyIdentifier: relyingParty, userHandle: userHandle, newName: name) }
    }
    #endif
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      return run(completion) { try await ASCredentialUpdater().reportPublicKeyCredentialUpdate(relyingPartyIdentifier: relyingParty, userHandle: userHandle, newName: name) }
    }
    #endif
    completion(unsupported)
  }

  private static func run(_ completion: @escaping @Sendable (Error?) -> Void, _ report: @escaping @Sendable () async throws -> Void) {
    Task {
      do { try await report(); completion(nil) } catch { completion(error) }
    }
  }

  /// SparkAuthorization checks `supported` first, so this is reached only if that check is skipped.
  private static let unsupported = NSError(domain: "so.legend.spark.authentication", code: 0, userInfo: ["code": "E_UNAVAILABLE", NSLocalizedDescriptionKey: "Credential signals need macOS 26"])
}
