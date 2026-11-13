import Foundation

/// Tells the website a catalog install link reached this Mac, so it can say "Approve it in omgskills."
/// Best effort: one short request, no retries, every failure ignored.
struct CatalogInstallAck: Sendable {
    static let timeout: TimeInterval = 10

    private let endpoint: URL?
    private let session: any DeviceHTTPSession
    private let now: @Sendable () -> Date

    init(uploadEndpoint: URL, session: any DeviceHTTPSession = URLSession.shared,
         now: @escaping @Sendable () -> Date = { Date() }, allowLoopbackHTTP: Bool = debugAllowsLoopbackHTTP) {
        if SkillSyncService.isAllowedEndpoint(uploadEndpoint, allowLoopbackHTTP: allowLoopbackHTTP),
           var components = URLComponents(url: uploadEndpoint, resolvingAgainstBaseURL: false),
           components.user == nil, components.password == nil {
            components.path = "/api/portal/install-ack"
            components.query = nil
            components.fragment = nil
            endpoint = components.url
        } else {
            endpoint = nil
        }
        self.session = session
        self.now = now
    }

    /// Starts the ack in the background and returns at once; skipped when the Mac is not connected.
    @discardableResult
    func fire(_ request: CatalogInstallRequest, credential: StoredDeviceCredential?) -> Task<Void, Never>? {
        guard let credential, credential.connection.expiresAt > now(), endpoint != nil else { return nil }
        return Task.detached(priority: .utility) { await send(request, credential: credential) }
    }

    func send(_ request: CatalogInstallRequest, credential: StoredDeviceCredential) async {
        guard let endpoint else { return }
        var urlRequest = URLRequest(url: endpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = Self.timeout
        urlRequest.setValue("Bearer \(credential.credential)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let agent = request.target == .claude ? "claude" : "codex"
        urlRequest.httpBody = try? JSONSerialization.data(
            withJSONObject: ["catalogId": request.catalogID, "agent": agent], options: [.sortedKeys])
        _ = try? await session.data(for: urlRequest)
    }

    private static var debugAllowsLoopbackHTTP: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
}
