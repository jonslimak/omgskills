import Foundation
import Security
import Testing
@testable import omgskills

struct DeviceCredentialStoreTests {
    @Test func conditionalDeletionPreservesReplacementWithSameDeviceID() async throws {
        let fake = TestDeviceKeychain()
        let store: any DeviceCredentialStoring = DeviceCredentialStore(service: "test.credentials", keychain: fake.operations)
        let first = makeCredential(deviceID: "same-id", credential: "old-secret")
        let replacement = makeCredential(deviceID: "same-id", credential: "new-secret")
        try await store.save(first, replacingExisting: false)
        try await store.save(replacement, replacingExisting: false)
        #expect(try await store.delete(ifMatching: first) == false)
        #expect(try await store.load() == replacement)
        #expect(fake.calls().allSatisfy { $0.operation != .delete })
        #expect(try await store.delete(ifMatching: replacement))
        #expect(try await store.load() == nil)
        #expect(try await store.delete(ifMatching: replacement) == false)
    }

    @Test func conditionalDeletionChecksMetadataAsWellAsBearerAndDevice() async throws {
        let fake = TestDeviceKeychain()
        let store = DeviceCredentialStore(service: "test.credentials", keychain: fake.operations)
        let first = makeCredential(deviceID: "same-id", credential: "same-secret")
        let changed = StoredDeviceCredential(credential: first.credential, connection: .init(
            deviceID: "same-id", accountLabel: "Different account", expiresAt: first.connection.expiresAt))
        try await store.save(changed, replacingExisting: false)
        #expect(try await store.delete(ifMatching: first) == false)
        #expect(try await store.load() == changed)
    }

    @Test func conditionalDeletionPropagatesStorageErrorsWithoutDeleting() async throws {
        let fake = TestDeviceKeychain()
        let store = DeviceCredentialStore(service: "test.credentials", keychain: fake.operations)
        let record = makeCredential(deviceID: "id", credential: "secret")
        try await store.save(record, replacingExisting: false)
        fake.fail(.copy, with: errSecInteractionNotAllowed)
        await #expect(throws: DeviceCredentialStoreError.keychain(errSecInteractionNotAllowed)) {
            try await store.delete(ifMatching: record)
        }
        fake.fail(.copy, with: nil)
        fake.fail(.delete, with: errSecAuthFailed)
        await #expect(throws: DeviceCredentialStoreError.keychain(errSecAuthFailed)) {
            try await store.delete(ifMatching: record)
        }
        fake.fail(.delete, with: nil)
        #expect(try await store.load() == record)
        fake.seed(service: "test.credentials", account: "id", data: Data("corrupt".utf8))
        await #expect(throws: (any Error).self) { try await store.delete(ifMatching: record) }
    }

    @Test func conditionalDeletionDefaultFailsWithoutImplementation() async {
        let store = UnsupportedConditionalCredentialStore()
        await #expect(throws: DeviceCredentialStoreError.conditionalDeletionUnsupported) {
            try await store.delete(ifMatching: makeCredential(deviceID: "id", credential: "secret"))
        }
    }

    @Test func configuredServiceUsesBundleOverride() throws {
        let bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("KeychainService-\(UUID().uuidString).bundle")
        let contentsURL = bundleURL.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contentsURL, withIntermediateDirectories: true)
        try """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>CFBundleIdentifier</key>
            <string>com.jonslimak.omgskills.tests.keychain-service</string>
            <key>OMGSkillsPortalSyncKeychainService</key>
            <string>com.jonslimak.omgskills.portal-sync.auth5-draft</string>
        </dict>
        </plist>
        """.write(to: contentsURL.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: bundleURL) }
        let bundle = try #require(Bundle(url: bundleURL))

        #expect(
            DeviceCredentialStore.configuredService(bundle: bundle)
                == "com.jonslimak.omgskills.portal-sync.auth5-draft"
        )
    }

    @Test func configuredServiceFallsBackWhenOverrideIsMissing() {
        let service = DeviceCredentialStore.configuredService(bundle: Bundle(for: EmptyKeychainBundleMarker.self))

        #expect(service == DeviceCredentialStore.defaultService)
    }

    @Test func persistsAndDeletesCredentialUsingKeychainOperations() async throws {
        let fake = TestDeviceKeychain()
        let store = DeviceCredentialStore(service: uniqueService(), keychain: fake.operations)
        let record = makeCredential(deviceID: "device-1", credential: "secret-1")

        try await store.save(record, replacingExisting: false)
        #expect(try await store.load() == record)

        _ = try await store.delete(ifMatching: record)
        #expect(try await store.load() == nil)
    }

    @Test func replacingAnotherDeviceRequiresExplicitApproval() async throws {
        let fake = TestDeviceKeychain()
        let store = DeviceCredentialStore(service: uniqueService(), keychain: fake.operations)
        let first = makeCredential(deviceID: "device-1", credential: "secret-1")
        let replacement = makeCredential(deviceID: "device-2", credential: "secret-2")

        try await store.save(first, replacingExisting: false)
        await #expect(throws: DeviceCredentialStoreError.replacementRequired) {
            try await store.save(replacement, replacingExisting: false)
        }
        #expect(try await store.load() == first)

        try await store.save(replacement, replacingExisting: true)
        #expect(try await store.load() == replacement)

        _ = try await store.delete(ifMatching: replacement)
    }

    @Test func legacyCredentialWithoutScopesDecodesAsMetadataOnly() throws {
        let data = try #require("""
        {
          "credential": "legacy-secret",
          "connection": {
            "deviceID": "legacy-device",
            "accountLabel": "jon@example.com",
            "expiresAt": 1800000000
          }
        }
        """.data(using: .utf8))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970

        let record = try decoder.decode(StoredDeviceCredential.self, from: data)

        #expect(record.connection.grantedScopes == DeviceScope.metadataOnly)
    }

    private func uniqueService() -> String {
        "com.jonslimak.omgskills.tests.portal-sync.\(UUID().uuidString)"
    }

    private func makeCredential(
        deviceID: String,
        credential: String
    ) -> StoredDeviceCredential {
        StoredDeviceCredential(
            credential: credential,
            connection: DeviceConnectionInfo(
                deviceID: deviceID,
                accountLabel: "jon@example.com",
                expiresAt: Date(timeIntervalSince1970: 1_800_000_000)
            )
        )
    }
}

private final class EmptyKeychainBundleMarker {}

private actor UnsupportedConditionalCredentialStore: DeviceCredentialStoring {
    func load() async throws -> StoredDeviceCredential? { nil }
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws {}
}

// All mutable fake state is protected by one lock; callbacks stay synchronous,
// just like Security operations inside the real store actor.
final class TestDeviceKeychain: @unchecked Sendable {
    enum Operation: Hashable { case copy, add, update, delete }
    struct Call {
        let operation: Operation
        let service: String?
        let account: String?
        let synchronizable: Bool?
        let accessible: String?
    }
    private struct ItemKey: Hashable { let service: String; let account: String }
    private let lock = NSLock()
    private var items: [ItemKey: Data] = [:]
    private var recorded: [Call] = []
    private var failures: [Operation: OSStatus] = [:]
    private var duplicateWinner: Data?

    var operations: DeviceKeychainOperations {
        .init(copyMatching: { self.copy($0) }, update: { self.update($0, $1) },
              add: { self.add($0) }, delete: { self.delete($0) })
    }

    func calls() -> [Call] { lock.withLock { recorded } }
    func fail(_ operation: Operation, with status: OSStatus?) { lock.withLock { failures[operation] = status } }
    func seed(service: String, account: String, data: Data) {
        lock.withLock { items[.init(service: service, account: account)] = data }
    }
    func competeOnNextAdd(with data: Data) { lock.withLock { duplicateWinner = data } }

    private func record(_ operation: Operation, _ query: [String: Any]) {
        recorded.append(.init(operation: operation, service: query[kSecAttrService as String] as? String,
            account: query[kSecAttrAccount as String] as? String,
            synchronizable: query[kSecAttrSynchronizable as String] as? Bool,
            accessible: query[kSecAttrAccessible as String] as? String))
    }
    private func itemKey(_ query: [String: Any]) -> ItemKey? {
        guard let service = query[kSecAttrService as String] as? String,
              let account = query[kSecAttrAccount as String] as? String else { return nil }
        return .init(service: service, account: account)
    }
    private func copy(_ query: [String: Any]) -> (OSStatus, CFTypeRef?) {
        lock.withLock {
            record(.copy, query)
            if let failure = failures[.copy] { return (failure, nil) }
            let matches = items.filter { key, _ in
                key.service == query[kSecAttrService as String] as? String
                && (query[kSecAttrAccount as String] == nil || key.account == query[kSecAttrAccount as String] as? String)
            }
            guard !matches.isEmpty else { return (errSecItemNotFound, nil) }
            if query[kSecReturnAttributes as String] as? Bool == true {
                return (errSecSuccess, matches.keys.map { [kSecAttrAccount as String: $0.account] } as NSArray)
            }
            return (errSecSuccess, matches.first!.value as NSData)
        }
    }
    private func add(_ query: [String: Any]) -> OSStatus {
        lock.withLock {
            record(.add, query)
            if let failure = failures[.add] { return failure }
            guard let key = itemKey(query), let data = query[kSecValueData as String] as? Data else { return errSecParam }
            if let winner = duplicateWinner {
                items[key] = winner
                duplicateWinner = nil
                return errSecDuplicateItem
            }
            guard items[key] == nil else { return errSecDuplicateItem }
            items[key] = data
            return errSecSuccess
        }
    }
    private func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
        lock.withLock {
            record(.update, query)
            if let failure = failures[.update] { return failure }
            guard let old = itemKey(query), let oldData = items[old] else { return errSecItemNotFound }
            let next = ItemKey(service: old.service, account: attributes[kSecAttrAccount as String] as? String ?? old.account)
            if next != old, items[next] != nil { return errSecDuplicateItem }
            items.removeValue(forKey: old)
            items[next] = attributes[kSecValueData as String] as? Data ?? oldData
            return errSecSuccess
        }
    }
    private func delete(_ query: [String: Any]) -> OSStatus {
        lock.withLock {
            record(.delete, query)
            if let failure = failures[.delete] { return failure }
            guard let key = itemKey(query) else { return errSecParam }
            return items.removeValue(forKey: key) == nil ? errSecItemNotFound : errSecSuccess
        }
    }
}
