import Darwin
import Foundation

public enum InstallFailure: LocalizedError, Equatable {
    case unsafeRoot, unsafePath, busy, unmanaged, changed, invalidRecord, staleReview, noBackup, unreviewable, io

    public var errorDescription: String? {
        switch self {
        case .unsafeRoot: "The helper storage or destination folder is not safely configured. Nothing was replaced."
        case .unsafePath: "An unexpected file, link, or permission was found. Nothing was replaced."
        case .busy: "Another helper operation is running. Try again."
        case .unmanaged: "This destination belongs to another installation. Nothing was replaced."
        case .changed: "Installed files or permissions have changed. Your changes were kept."
        case .invalidRecord: "The installation record could not be verified. Nothing was replaced."
        case .staleReview: "The reviewed version changed. Review again before applying."
        case .noBackup: "No verified previous version is available."
        case .unreviewable: "This change cannot be fully reviewed as bounded text. Nothing was replaced."
        case .io: "The local operation failed. Reopen to check the active version."
        }
    }
}

// All operations below stay relative to open directory descriptors, not paths supplied by a link.
final class SandboxDirectory {
    let fd: Int32
    init(fd: Int32) throws {
        guard fd >= 0 else { throw InstallFailure.unsafePath }
        self.fd = fd
    }
    deinit { Darwin.close(fd) }

    static func absolute(_ url: URL) throws -> SandboxDirectory {
        var directory = try SandboxDirectory(fd: Darwin.open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW))
        for part in url.pathComponents.dropFirst() {
            directory = try directory.child(part, owned: false)
        }
        return directory
    }

    func owned() throws {
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o077 == 0 else {
            throw InstallFailure.unsafeRoot
        }
    }

    // Agent folders commonly use 0755. Do not weaken the private store's 0700 rule.
    func userDirectory() throws {
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o022 == 0 else {
            throw InstallFailure.unsafeRoot
        }
    }

    func sameDirectory(as other: SandboxDirectory) throws -> Bool {
        var a = stat(), b = stat()
        guard fstat(fd, &a) == 0, fstat(other.fd, &b) == 0 else { throw InstallFailure.io }
        return a.st_dev == b.st_dev && a.st_ino == b.st_ino
    }

    func identity() throws -> String {
        var info = stat()
        guard fstat(fd, &info) == 0 else { throw InstallFailure.io }
        return "\(info.st_dev):\(info.st_ino)"
    }

    func userChild(_ name: String, create: Bool = false) throws -> SandboxDirectory {
        let result = try child(name, create: create, owned: false)
        try result.userDirectory()
        return result
    }

    func child(_ name: String, create: Bool = false, owned: Bool = true) throws -> SandboxDirectory {
        try Self.name(name)
        if create, mkdirat(fd, name, 0o700) != 0, errno != EEXIST { throw InstallFailure.io }
        let result = try SandboxDirectory(fd: openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW))
        if owned { try result.owned() }
        return result
    }

    func parent(of path: String, create: Bool = false) throws -> (SandboxDirectory, String) {
        guard PublicPin.safePackagePath(path) else { throw InstallFailure.unsafePath }
        let parts = path.split(separator: "/").map(String.init)
        var directory = self
        for part in parts.dropLast() { directory = try directory.child(part, create: create) }
        return (directory, parts.last!)
    }

    func info(_ name: String) throws -> stat? {
        try Self.name(name)
        var value = stat()
        if fstatat(fd, name, &value, AT_SYMLINK_NOFOLLOW) == 0 { return value }
        if errno == ENOENT { return nil }
        throw InstallFailure.io
    }

    func read(_ path: String, limit: Int) throws -> (Data, mode_t) {
        let (directory, name) = try parent(of: path)
        let file = openat(directory.fd, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard file >= 0 else { throw InstallFailure.unsafePath }
        defer { Darwin.close(file) }
        var info = stat()
        guard fstat(file, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_nlink == 1, info.st_uid == getuid(), info.st_size >= 0, info.st_size <= limit else {
            throw InstallFailure.unsafePath
        }
        var bytes = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = Darwin.read(file, &buffer, buffer.count)
            if count == -1, errno == EINTR { continue }
            guard count >= 0 else { throw InstallFailure.io }
            if count == 0 { break }
            guard bytes.count + count <= limit else { throw InstallFailure.unsafePath }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        return (bytes, info.st_mode & 0o7777)
    }

    func write(_ path: String, data: Data, mode: mode_t = 0o600) throws {
        let (directory, name) = try parent(of: path, create: true)
        let file = openat(directory.fd, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard file >= 0 else { throw InstallFailure.unsafePath }
        defer { Darwin.close(file) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(file, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count == -1, errno == EINTR { continue }
                guard count > 0 else { throw InstallFailure.io }
                offset += count
            }
        }
        guard fchmod(file, mode) == 0, fsync(file) == 0 else { throw InstallFailure.io }
    }

    func names() throws -> [String] {
        // Opening "." gives enumeration its own offset; dup would share the original directory offset.
        let copy = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard copy >= 0 else { throw InstallFailure.io }
        guard let stream = fdopendir(copy) else { Darwin.close(copy); throw InstallFailure.io }
        defer { closedir(stream) }
        var result: [String] = []
        while true {
            errno = 0
            guard let entry = readdir(stream) else {
                guard errno == 0 else { throw InstallFailure.io }
                break
            }
            let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) {
                    String(validatingCString: $0)
                }
            }
            guard let name else { throw InstallFailure.unsafePath }
            if name != ".", name != ".." { result.append(name) }
            guard result.count <= 2048 else { throw InstallFailure.unsafePath }
        }
        return result.sorted()
    }

    func link(_ name: String) throws -> String {
        try Self.name(name)
        guard let info = try info(name), info.st_mode & S_IFMT == S_IFLNK,
              info.st_uid == getuid(), info.st_nlink == 1 else {
            throw InstallFailure.unmanaged
        }
        var bytes = [CChar](repeating: 0, count: 4096)
        let count = readlinkat(fd, name, &bytes, bytes.count - 1)
        guard count > 0, count < bytes.count - 1 else { throw InstallFailure.unsafePath }
        return bytes.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
    }

    func lock() throws -> SandboxLock {
        let lock = openat(fd, "install.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o600)
        guard lock >= 0 else { throw InstallFailure.unsafePath }
        var info = stat()
        guard fstat(lock, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_nlink == 1, info.st_mode & 0o7777 == 0o600 else {
            Darwin.close(lock)
            throw InstallFailure.unsafePath
        }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { Darwin.close(lock); throw InstallFailure.busy }
        return SandboxLock(fd: lock)
    }

    private static func name(_ name: String) throws {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0") else {
            throw InstallFailure.unsafePath
        }
    }
}

final class SandboxLock {
    private var fd: Int32
    init(fd: Int32) { self.fd = fd }
    func release() {
        if fd >= 0 { flock(fd, LOCK_UN); Darwin.close(fd); fd = -1 }
    }
    deinit { release() }
}

package struct InstallSandbox: Sendable {
    package let url: URL
    package let id: String
    static let prefix = "omgskills-h12-"

    package static func create() throws -> InstallSandbox {
        let parent = try temporaryParent()
        let id = UUID().uuidString
        let name = prefix + id
        let base = try SandboxDirectory.absolute(parent)
        guard mkdirat(base.fd, name, 0o700) == 0 else { throw InstallFailure.io }
        let root = try base.child(name)
        try root.write("sandbox.json", data: JSONEncoder().encode(Marker(schema: 1, id: id)))
        return try InstallSandbox(path: parent.appendingPathComponent(name).path)
    }

    package init(path: String) throws {
        let url = URL(fileURLWithPath: path)
        let parents = [try Self.temporaryParent().path, "/private/tmp"]
        guard path.hasPrefix("/"), path == url.path, parents.contains(url.deletingLastPathComponent().path),
              url.lastPathComponent.hasPrefix(Self.prefix) else {
            throw InstallFailure.unsafeRoot
        }
        let id = String(url.lastPathComponent.dropFirst(Self.prefix.count))
        guard UUID(uuidString: id)?.uuidString == id else { throw InstallFailure.unsafeRoot }
        self.url = url
        self.id = id
        _ = try open()
    }

    func open() throws -> SandboxDirectory {
        let root = try SandboxDirectory.absolute(url)
        try root.owned()
        let (bytes, mode) = try root.read("sandbox.json", limit: 1024)
        guard mode == 0o600, let marker = try? JSONDecoder().decode(Marker.self, from: bytes),
              marker.schema == 1, marker.id == id else { throw InstallFailure.unsafeRoot }
        return root
    }

    private struct Marker: Codable { let schema: Int; let id: String }

    private static func temporaryParent() throws -> URL {
        // Foundation standardization folds /private/var back to the /var symlink on macOS.
        // Canonicalize only the trusted system parent; never resolve an untrusted sandbox leaf.
        guard let pointer = realpath(FileManager.default.temporaryDirectory.path, nil) else { throw InstallFailure.unsafeRoot }
        defer { free(pointer) }
        return URL(fileURLWithPath: String(cString: pointer))
    }
}
