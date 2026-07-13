import Foundation
import Testing
@testable import omgskills

struct DeviceCredentialStoreTests {
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

private final class EmptyKeychainBundleMarker {}
