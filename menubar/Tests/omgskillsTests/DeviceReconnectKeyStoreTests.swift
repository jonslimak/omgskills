import Foundation
import Security
import Testing
@testable import omgskills

struct DeviceReconnectKeyStoreTests {
    private let origin = URL(string: "https://example.test")!
    private let service = "test.credentials"
    private let bytes = Data(0..<32)

    @Test func persistsOneKeyInSeparateNonSynchronizingService() async throws {
        let fake = TestDeviceKeychain()
        let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { Data(0..<32) })
        let key = try await store.loadOrCreate()
        #expect(key == "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
        let reopened = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { throw DeviceReconnectKeyStoreError.randomGenerationFailed })
        #expect(try await reopened.loadOrCreate() == key)
        #expect(fake.calls().filter { $0.operation == .add }.count == 1)
        #expect(fake.calls().allSatisfy { $0.service == "test.credentials.reconnect" && $0.synchronizable == false })
        #expect(fake.calls().allSatisfy { $0.account == "https://example.test:443" })
        #expect(fake.calls().first { $0.operation == .add }?.accessible == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        let credentials = DeviceCredentialStore(service: service, keychain: fake.operations)
        #expect(try await credentials.load() == nil)
    }

    @Test func originNormalizationAndServiceNamesKeepScopesSeparate() async throws {
        #expect(try DeviceReconnectKeyStore.normalizedOrigin(URL(string: "HTTPS://EXAMPLE.test:443/")!) == "https://example.test:443")
        #expect(try DeviceReconnectKeyStore.normalizedOrigin(URL(string: "http://localhost")!) == "http://localhost:80")
        #expect(try DeviceReconnectKeyStore.normalizedOrigin(URL(string: "http://[::1]:5201/")!) == "http://[::1]:5201")
        let fake = TestDeviceKeychain()
        fake.seed(service: service + ".reconnect", account: "https://example.test:443", data: Data(String(repeating: "a", count: 64).utf8))
        for (url, name, expected) in [(origin, service, String(repeating: "a", count: 64)),
            (URL(string: "https://other.test")!, service, String(repeating: "b", count: 64)),
            (URL(string: "https://example.test:444")!, service, String(repeating: "b", count: 64)),
            (origin, "other-service", String(repeating: "b", count: 64))] {
            let store = try DeviceReconnectKeyStore(apiOrigin: url, credentialService: name,
                keychain: fake.operations, randomBytes: { Data(repeating: 0xbb, count: 32) })
            #expect(try await store.loadOrCreate() == expected)
        }
    }

    @Test func rejectsInvalidScopeWithoutAnyStorageOperation() throws {
        let fake = TestDeviceKeychain()
        for value in ["ftp://example.test", "http://example.test", "https://user:password@example.test",
                      "https://example.test/path", "https://example.test?key=x", "https://example.test#key",
                      "https://example.test:0", "https://example.test:65536", "file:///tmp/local"] {
            #expect(throws: DeviceReconnectKeyStoreError.invalidScope) {
                try DeviceReconnectKeyStore(apiOrigin: URL(string: value)!, credentialService: service, keychain: fake.operations)
            }
        }
        for name in ["", " ", " test", "test\nname"] {
            #expect(throws: DeviceReconnectKeyStoreError.invalidScope) {
                try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: name, keychain: fake.operations)
            }
        }
        #expect(fake.calls().isEmpty)
    }

    @Test func corruptOrInaccessibleKeyIsNeverReplaced() async throws {
        for data in [Data("short".utf8), Data(String(repeating: "A", count: 64).utf8),
                     Data((String(repeating: "a", count: 64) + "\n").utf8), Data([0xff])] {
            let fake = TestDeviceKeychain()
            fake.seed(service: service + ".reconnect", account: "https://example.test:443", data: data)
            let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
                keychain: fake.operations, randomBytes: { Data(0..<32) })
            await #expect(throws: DeviceReconnectKeyStoreError.corruptItem) { try await store.loadOrCreate() }
            #expect(fake.calls().allSatisfy { $0.operation == .copy })
        }
        let fake = TestDeviceKeychain()
        fake.fail(.copy, with: errSecInteractionNotAllowed)
        let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { Data(0..<32) })
        await #expect(throws: DeviceReconnectKeyStoreError.keychain(errSecInteractionNotAllowed)) { try await store.loadOrCreate() }
        #expect(fake.calls().allSatisfy { $0.operation == .copy })
    }

    @Test func randomAndWriteFailuresDoNotClaimSuccess() async throws {
        for count in [0, 31, 33] {
            let fake = TestDeviceKeychain()
            let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
                keychain: fake.operations, randomBytes: { Data(repeating: 1, count: count) })
            await #expect(throws: DeviceReconnectKeyStoreError.randomGenerationFailed) { try await store.loadOrCreate() }
            #expect(fake.calls().allSatisfy { $0.operation == .copy })
        }
        let fake = TestDeviceKeychain()
        let failedRandom = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { throw URLError(.unknown) })
        await #expect(throws: DeviceReconnectKeyStoreError.randomGenerationFailed) { try await failedRandom.loadOrCreate() }
        fake.fail(.add, with: errSecAuthFailed)
        let failedWrite = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { Data(0..<32) })
        await #expect(throws: DeviceReconnectKeyStoreError.keychain(errSecAuthFailed)) { try await failedWrite.loadOrCreate() }
    }

    @Test func duplicateCreationLoadsWinnerInsteadOfOverwritingIt() async throws {
        let fake = TestDeviceKeychain()
        let winner = String(repeating: "c", count: 64)
        fake.competeOnNextAdd(with: Data(winner.utf8))
        let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { Data(0..<32) })
        #expect(try await store.loadOrCreate() == winner)
        #expect(fake.calls().filter { $0.operation == .copy }.count == 2)
        #expect(fake.calls().allSatisfy { $0.operation != .update && $0.operation != .delete })
        let invalid = TestDeviceKeychain()
        invalid.competeOnNextAdd(with: Data("corrupt winner".utf8))
        let invalidStore = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: invalid.operations, randomBytes: { Data(0..<32) })
        await #expect(throws: DeviceReconnectKeyStoreError.corruptItem) { try await invalidStore.loadOrCreate() }
    }

    @Test func concurrentCallsShareTheSameKey() async throws {
        let fake = TestDeviceKeychain()
        let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { Data(0..<32) })
        let keys = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<12 { group.addTask { try await store.loadOrCreate() } }
            var values: [String] = []
            for try await value in group { values.append(value) }
            return values
        }
        #expect(Set(keys).count == 1)
        #expect(fake.calls().filter { $0.operation == .add }.count == 1)
    }

    @Test func cancelledCallDoesNotTouchStorage() async throws {
        let fake = TestDeviceKeychain()
        let store = try DeviceReconnectKeyStore(apiOrigin: origin, credentialService: service,
            keychain: fake.operations, randomBytes: { Data(0..<32) })
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await store.loadOrCreate()
        }
        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(fake.calls().isEmpty)
    }
}
