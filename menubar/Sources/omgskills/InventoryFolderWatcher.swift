import Foundation
import CoreServices
import Darwin

@MainActor
final class InventoryFolderWatcher {
    enum Failure: Error { case invalidRoots, unavailableAncestor, cannotStart }

    private let roots: [URL]
    private let anchor: URL
    private let onChange: @MainActor @Sendable () -> Void
    private var stream: Stream?
    private var generation = UUID()
    private(set) var isWatching = false

    init(roots: [URL], anchor: URL, onChange: @escaping @MainActor @Sendable () -> Void) {
        self.roots = roots.map(\.standardizedFileURL)
        self.anchor = anchor.standardizedFileURL
        self.onChange = onChange
    }

    func start() throws {
        guard !isWatching else { return }
        let paths = try observationPaths()
        let session = UUID()
        generation = session
        let callback = Callback(roots: try roots.map(Self.eventPath)) { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, isWatching, generation == session else { return }
                onChange()
            }
        }
        var context = FSEventStreamContext(version: 0,
            info: Unmanaged.passUnretained(callback).toOpaque(),
            retain: { info in
                guard let info else { return nil }
                return UnsafeRawPointer(Unmanaged<Callback>.fromOpaque(info).retain().toOpaque())
            }, release: { info in
                if let info { Unmanaged<Callback>.fromOpaque(info).release() }
            }, copyDescription: nil)
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot)
        guard let created = FSEventStreamCreate(nil, { _, info, count, paths, flags, _ in
            guard let info else { return }
            let callback = Unmanaged<Callback>.fromOpaque(info).takeUnretainedValue()
            let strings = paths.assumingMemoryBound(to: UnsafePointer<CChar>.self)
            for index in 0..<count {
                var path = String(cString: strings[index])
                while path.count > 1, path.hasSuffix("/") { path.removeLast() }
                if callback.accepts(path: path, flags: flags[index]) {
                    callback.deliver()
                    break
                }
            }
        }, &context, paths as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.1, flags) else {
            throw Failure.cannotStart
        }
        FSEventStreamSetDispatchQueue(created, DispatchQueue.main)
        guard FSEventStreamStart(created) else {
            FSEventStreamInvalidate(created)
            FSEventStreamRelease(created)
            throw Failure.cannotStart
        }
        stream = Stream(created)
        isWatching = true
    }

    func stop() {
        generation = UUID()
        isWatching = false
        stream = nil
    }

    // Watch stable ancestors, so a root can disappear and return without reopening descriptors.
    func observationPaths() throws -> [String] {
        guard !roots.isEmpty, roots.allSatisfy({ $0.path.hasPrefix(anchor.path + "/") }) else {
            throw Failure.invalidRoots
        }
        let fm = FileManager.default
        var anchorDirectory: ObjCBool = false
        guard fm.fileExists(atPath: anchor.path, isDirectory: &anchorDirectory), anchorDirectory.boolValue,
              anchor.resolvingSymlinksInPath().path == anchor.path else { throw Failure.unavailableAncestor }
        for root in roots {
            var ancestor = root.deletingLastPathComponent()
            while true {
                var directory: ObjCBool = false
                if fm.fileExists(atPath: ancestor.path, isDirectory: &directory), directory.boolValue {
                    // Do not silently start watching an unrelated redirected hierarchy.
                    guard ancestor.resolvingSymlinksInPath().path == ancestor.path else { throw Failure.unavailableAncestor }
                    break
                }
                guard ancestor.path != anchor.path else { throw Failure.unavailableAncestor }
                ancestor.deleteLastPathComponent()
            }
        }
        // One stable anchor also survives deletion/recreation of the agent parent (.codex, etc.).
        // The callback filters to configured roots/ancestors; it never scans unrelated folders.
        return [anchor.path]
    }

    // FSEvents uses physical paths. Foundation's /private aliases depend on leaf existence.
    // Resolve only existing parents, then append missing components without filesystem lookup.
    private static func eventPath(_ root: URL) throws -> String {
        var parent = root.deletingLastPathComponent()
        var components = [root.lastPathComponent]
        while true {
            if let resolved = realpath(parent.path, nil) {
                defer { free(resolved) }
                let base = String(cString: resolved)
                return (base == "/" ? "" : base) + "/" + components.reversed().joined(separator: "/")
            }
            guard parent.path != "/" else { throw Failure.unavailableAncestor }
            components.append(parent.lastPathComponent)
            parent.deleteLastPathComponent()
        }
    }

    private final class Stream {
        let reference: FSEventStreamRef
        init(_ reference: FSEventStreamRef) { self.reference = reference }
        deinit {
            FSEventStreamStop(reference)
            FSEventStreamInvalidate(reference)
            FSEventStreamRelease(reference)
        }
    }

    private final class Callback: Sendable {
        let roots: [String]
        let deliver: @Sendable () -> Void
        init(roots: [String], deliver: @escaping @Sendable () -> Void) {
            self.roots = roots
            self.deliver = deliver
        }
        func accepts(path: String, flags: FSEventStreamEventFlags) -> Bool {
            let rescan = FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs
                | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped
                | kFSEventStreamEventFlagRootChanged | kFSEventStreamEventFlagMount | kFSEventStreamEventFlagUnmount)
            if flags & rescan != 0 { return true }
            return roots.contains { path == $0 || path.hasPrefix($0 + "/") || $0.hasPrefix(path + "/") }
        }
    }
}
