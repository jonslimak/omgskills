import Foundation
import Security

enum DeviceReconnectKeyStoreError: LocalizedError, Equatable, Sendable {
    case invalidScope
    case invalidKey
    case corruptItem
    case randomGenerationFailed
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidScope: "The reconnect storage configuration is invalid."
        case .invalidKey, .corruptItem: "The saved reconnect key is invalid. It was not replaced."
        case .randomGenerationFailed: "A reconnect key could not be generated."
        case .keychain: "The reconnect key could not be accessed securely."
        }
    }
}

protocol DeviceReconnectKeyStoring: Sendable {
    func loadOrCreate() async throws -> String
}

actor DeviceReconnectKeyStore: DeviceReconnectKeyStoring {
    private let service: String
    private let account: String
    private let keychain: DeviceKeychainOperations
    private let randomBytes: @Sendable () throws -> Data

    init(apiOrigin: URL, credentialService: String, keychain: DeviceKeychainOperations = .live,
         randomBytes: @escaping @Sendable () throws -> Data = DeviceReconnectKeyStore.systemRandomBytes) throws {
        guard !credentialService.isEmpty,
              credentialService == credentialService.trimmingCharacters(in: .whitespacesAndNewlines),
              !credentialService.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw DeviceReconnectKeyStoreError.invalidScope
        }
        account = try Self.normalizedOrigin(apiOrigin)
        service = credentialService + ".reconnect"
        self.keychain = keychain
        self.randomBytes = randomBytes
    }

    static func isValidKey(_ key: String) -> Bool {
        key.utf8.count == 64 && key.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    static func normalizedOrigin(_ origin: URL) throws -> String {
        guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty,
              ["http", "https"].contains(scheme), parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil, ["", "/"].contains(parts.percentEncodedPath),
              parts.port.map({ (1...65535).contains($0) }) ?? true,
              scheme == "https" || ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host) else {
            throw DeviceReconnectKeyStoreError.invalidScope
        }
        parts.scheme = scheme
        parts.host = host
        parts.port = parts.port ?? (scheme == "https" ? 443 : 80)
        parts.path = ""
        guard let result = parts.string else { throw DeviceReconnectKeyStoreError.invalidScope }
        return result
    }

    func loadOrCreate() throws -> String {
        try Task.checkCancellation()
        if let stored = try load() { return stored }
        let bytes: Data
        do { bytes = try randomBytes() }
        catch { throw DeviceReconnectKeyStoreError.randomGenerationFailed }
        guard bytes.count == 32 else { throw DeviceReconnectKeyStoreError.randomGenerationFailed }
        let key = bytes.map { String(format: "%02x", $0) }.joined()
        try Task.checkCancellation()
        var query = baseQuery()
        query[kSecValueData as String] = Data(key.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = keychain.add(query)
        if status == errSecDuplicateItem {
            // Another store instance may have created the same scoped item.
            guard let stored = try load() else { throw DeviceReconnectKeyStoreError.corruptItem }
            return stored
        }
        guard status == errSecSuccess else { throw DeviceReconnectKeyStoreError.keychain(status) }
        return key
    }

    private func load() throws -> String? {
        var query = baseQuery()
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        let (status, value) = keychain.copyMatching(query)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw DeviceReconnectKeyStoreError.keychain(status) }
        guard let data = value as? Data, let key = String(data: data, encoding: .utf8), Self.isValidKey(key) else {
            throw DeviceReconnectKeyStoreError.corruptItem
        }
        return key
    }

    private func baseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }

    static func systemRandomBytes() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw DeviceReconnectKeyStoreError.randomGenerationFailed }
        return Data(bytes)
    }
}
