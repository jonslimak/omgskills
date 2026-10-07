import CryptoKit
import Foundation

// Adapter for the unchanged validator shared with the Mac app via a source symlink.
package enum SkillIdentityResolver {
    package static func gitBlobSHA(for data: Data) -> String {
        GitObjectHash.sha(type: "blob", data: data)
    }
}

package enum GitObjectHash {
    package static func sha(type: String, data: Data) -> String {
        var object = Data("\(type) \(data.count)\0".utf8)
        object.append(data)
        return Insecure.SHA1.hash(data: object).map { String(format: "%02x", $0) }.joined()
    }
}
