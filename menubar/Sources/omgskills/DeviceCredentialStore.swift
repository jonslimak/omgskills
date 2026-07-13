import Foundation
import Security

struct DeviceConnectionInfo: Codable, Equatable, Sendable {
    let deviceID: String
    let accountLabel: String
    let expiresAt: Date
}

struct StoredDeviceCredential: Codable, Equatable, Sendable {
    let credential: String
    let connection: DeviceConnectionInfo
}

enum DeviceCredentialStoreError: Error, Equatable, Sendable {
    case replacementRequired
    case corruptItem
    case keychain(OSStatus)
}

protocol DeviceCredentialStoring: Sendable {
    func load() async throws -> StoredDeviceCredential?
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws
    func delete(deviceID: String) async throws
}

actor DeviceCredentialStore: DeviceCredentialStoring {
    static let defaultService = "com.jonslimak.omgskills.portal-sync"
    static let serviceInfoKey = "OMGSkillsPortalSyncKeychainService"

    static func configuredService(bundle: Bundle = .main) -> String {
        guard let value = bundle.object(forInfoDictionaryKey: serviceInfoKey) as? String else {
            return defaultService
        }
        let service = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return service.isEmpty ? defaultService : service
    }

    private let service: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(service: String = defaultService) {
        self.service = service
    }

    func load() throws -> StoredDeviceCredential? {
        var query = baseQuery()
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw DeviceCredentialStoreError.keychain(status)
        }
        guard
            let items = result as? [[String: Any]],
            items.count == 1,
            let account = items[0][kSecAttrAccount as String] as? String
        else {
            throw DeviceCredentialStoreError.corruptItem
        }

        var dataQuery = baseQuery()
        dataQuery[kSecAttrAccount as String] = account
        dataQuery[kSecMatchLimit as String] = kSecMatchLimitOne
        dataQuery[kSecReturnData as String] = true
        var dataResult: CFTypeRef?
        let dataStatus = SecItemCopyMatching(dataQuery as CFDictionary, &dataResult)
        guard dataStatus == errSecSuccess else {
            throw DeviceCredentialStoreError.keychain(dataStatus)
        }
        guard let data = dataResult as? Data else {
            throw DeviceCredentialStoreError.corruptItem
        }
        let record = try decoder.decode(StoredDeviceCredential.self, from: data)
        guard record.connection.deviceID == account else {
            throw DeviceCredentialStoreError.corruptItem
        }
        return record
    }

    func save(_ record: StoredDeviceCredential, replacingExisting: Bool = false) throws {
        let existing = try load()
        if let existing, existing.connection.deviceID != record.connection.deviceID, !replacingExisting {
            throw DeviceCredentialStoreError.replacementRequired
        }

        let data = try encoder.encode(record)
        let account = record.connection.deviceID
        if let existing, existing.connection.deviceID != account {
            var existingQuery = baseQuery()
            existingQuery[kSecAttrAccount as String] = existing.connection.deviceID
            let attributes: [String: Any] = [
                kSecAttrAccount as String: account,
                kSecValueData as String: data
            ]
            let status = SecItemUpdate(existingQuery as CFDictionary, attributes as CFDictionary)
            guard status == errSecSuccess else {
                throw DeviceCredentialStoreError.keychain(status)
            }
            return
        }

        var exactQuery = baseQuery()
        exactQuery[kSecAttrAccount as String] = account
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(exactQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var addQuery = exactQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw DeviceCredentialStoreError.keychain(addStatus)
            }
        } else if updateStatus != errSecSuccess {
            throw DeviceCredentialStoreError.keychain(updateStatus)
        }

    }

    func delete(deviceID: String) throws {
        var query = baseQuery()
        query[kSecAttrAccount as String] = deviceID
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DeviceCredentialStoreError.keychain(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
    }
}
