import Foundation

enum InventoryReportOutcome: Equatable, Sendable {
    case reported(partial: Bool)
    case checked
    case retryable(retryAfter: TimeInterval?)
    case revisionConflict
    case needsAttention
    case reconnectRequired
    case cancelled

    static func failure(_ error: any Error) -> Self {
        if error is CancellationError { return .cancelled }
        if let error = error as? DeviceSyncAPIError {
            switch error {
            case .reconnectRequired: return .reconnectRequired
            case .inventoryChanged: return .revisionConflict
            case .retryableServer(_, let delay): return .retryable(retryAfter: delay)
            case .rateLimited: return .retryable(retryAfter: nil)
            case .server(let code) where code == 408 || (500...599).contains(code):
                return .retryable(retryAfter: nil)
            default: return .needsAttention
            }
        }
        let error = error as NSError
        guard error.domain == NSURLErrorDomain else { return .needsAttention }
        if error.code == URLError.cancelled.rawValue { return .cancelled }
        let transient: [URLError.Code] = [.timedOut, .notConnectedToInternet, .networkConnectionLost,
            .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed]
        return transient.contains(where: { $0.rawValue == error.code })
            ? .retryable(retryAfter: nil) : .needsAttention
    }
}
