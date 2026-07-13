import Foundation
import Testing
@testable import omgskills

struct DeviceCredentialStoreTests {
    @Test func persistsAndDeletesCredentialInKeychain() async throws {
        let store = DeviceCredentialStore(service: uniqueService())
        let record = makeCredential(deviceID: "device-1", credential: "secret-1")

        try await store.save(record, replacingExisting: false)
        #expect(try await store.load() == record)

        try await store.delete(deviceID: record.connection.deviceID)
        #expect(try await store.load() == nil)
    }

    @Test func replacingAnotherDeviceRequiresExplicitApproval() async throws {
        let store = DeviceCredentialStore(service: uniqueService())
        let first = makeCredential(deviceID: "device-1", credential: "secret-1")
        let replacement = makeCredential(deviceID: "device-2", credential: "secret-2")

        try await store.save(first, replacingExisting: false)
        await #expect(throws: DeviceCredentialStoreError.replacementRequired) {
            try await store.save(replacement, replacingExisting: false)
        }
        #expect(try await store.load() == first)

        try await store.save(replacement, replacingExisting: true)
        #expect(try await store.load() == replacement)

        try await store.delete(deviceID: replacement.connection.deviceID)
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
