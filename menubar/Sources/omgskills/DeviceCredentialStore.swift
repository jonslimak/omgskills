import Foundation
import Security

enum DeviceScope: String, Codable, CaseIterable, Hashable, Sendable {
    case syncWrite = "sync:write"
    case selfRevoke = "self:revoke"
    case contentRead = "content:read"

    static let metadataOnly: Set<DeviceScope> = [.syncWrite, .selfRevoke]
}

struct DeviceConnectionInfo: Codable, Equatable, Sendable {
    let deviceID: String
    let accountLabel: String
    let expiresAt: Date
    let grantedScopes: Set<DeviceScope>

    init(
        deviceID: String,
        accountLabel: String,
        expiresAt: Date,
        grantedScopes: Set<DeviceScope> = DeviceScope.metadataOnly
    ) {
        self.deviceID = deviceID
        self.accountLabel = accountLabel
        self.expiresAt = expiresAt
        self.grantedScopes = grantedScopes
    }

    private enum CodingKeys: String, CodingKey {
        case deviceID
        case accountLabel
        case expiresAt
        case grantedScopes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        deviceID = try container.decode(String.self, forKey: .deviceID)
        accountLabel = try container.decode(String.self, forKey: .accountLabel)
        expiresAt = try container.decode(Date.self, forKey: .expiresAt)
        grantedScopes = try container.decodeIfPresent(Set<DeviceScope>.self, forKey: .grantedScopes)
            ?? DeviceScope.metadataOnly
    }
}

struct StoredDeviceCredential: Codable, Equatable, Sendable {
    let credential: String
    let connection: DeviceConnectionInfo
}

enum DeviceCredentialStoreError: Error, Equatable, Sendable {
    case replacementRequired
    case corruptItem
    case keychain(OSStatus)
    case conditionalDeletionUnsupported
}

protocol DeviceCredentialStoring: Sendable {
    func load() async throws -> StoredDeviceCredential?
    func save(_ record: StoredDeviceCredential, replacingExisting: Bool) async throws
    func delete(deviceID: String) async throws
    func delete(ifMatching expected: StoredDeviceCredential) async throws -> Bool
}

extension DeviceCredentialStoring {
    func delete(ifMatching expected: StoredDeviceCredential) async throws -> Bool {
        throw DeviceCredentialStoreError.conditionalDeletionUnsupported
    }
}

struct DeviceKeychainOperations: Sendable {
    let copyMatching: @Sendable ([String: Any]) -> (OSStatus, CFTypeRef?)
    let update: @Sendable ([String: Any], [String: Any]) -> OSStatus
    let add: @Sendable ([String: Any]) -> OSStatus
    let delete: @Sendable ([String: Any]) -> OSStatus

    static let live = DeviceKeychainOperations(
        copyMatching: { query in
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            return (status, result)
        },
        update: { SecItemUpdate($0 as CFDictionary, $1 as CFDictionary) },
        add: { SecItemAdd($0 as CFDictionary, nil) },
        delete: { SecItemDelete($0 as CFDictionary) }
    )
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
    private let keychain: DeviceKeychainOperations
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(service: String = defaultService, keychain: DeviceKeychainOperations = .live) {
        self.service = service
        self.keychain = keychain
    }

    func load() throws -> StoredDeviceCredential? {
        var query = baseQuery()
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true

        let (status, result) = keychain.copyMatching(query)
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
        let (dataStatus, dataResult) = keychain.copyMatching(dataQuery)
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
            let status = keychain.update(existingQuery, attributes)
            guard status == errSecSuccess else {
                throw DeviceCredentialStoreError.keychain(status)
            }
            return
        }

        var exactQuery = baseQuery()
        exactQuery[kSecAttrAccount as String] = account
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = keychain.update(exactQuery, attributes)
        if updateStatus == errSecItemNotFound {
            var addQuery = exactQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = keychain.add(addQuery)
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
        let status = keychain.delete(query)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DeviceCredentialStoreError.keychain(status)
        }
    }

    func delete(ifMatching expected: StoredDeviceCredential) async throws -> Bool {
        // No await between comparison and deletion: stale cleanup cannot delete
        // a replacement written through this actor with the same device ID.
        guard try load() == expected else { return false }
        var query = baseQuery()
        query[kSecAttrAccount as String] = expected.connection.deviceID
        let status = keychain.delete(query)
        if status == errSecItemNotFound { return false }
        guard status == errSecSuccess else { throw DeviceCredentialStoreError.keychain(status) }
        return true
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
    }
}
