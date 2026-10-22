import Foundation
import Testing
@testable import omgskills

struct F1RuntimeTests {
    @Test func runtimePathsSupportFirstInstallRepeatAndUpdate() async throws {
        let rawRoot = URL(fileURLWithPath: "/private/tmp/omgskills-f1-" + UUID().uuidString, isDirectory: true)
        let repository = try LocalGitPackageRepository(root: rawRoot)
        defer { repository.remove() }
        // Match the assembled app: home exists, but skills and managed storage do not.
        try FileManager.default.createDirectory(at: rawRoot.appendingPathComponent("home"), withIntermediateDirectories: false)
        let info: [String: Any] = ["CFBundleIdentifier": AppRuntimeConfiguration.f1BundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]],
            AppRuntimeConfiguration.f1RootKey: rawRoot.path,
            AppRuntimeConfiguration.f1WebsiteKey: "http://127.0.0.1:5197/app/preview/unified/"]
        guard case .enabled(let root, _) = AppRuntimeConfiguration.f1Mode(info: info, debugAllowed: true) else {
            Issue.record("Valid isolated test configuration was rejected"); return
        }
        let paths = SkillFilesystemPaths.isolated(testRoot: root)
        let managed = root.appendingPathComponent("managed")
        let installer = ManagedSkillInstaller(managedRoot: managed, pathAnchor: paths.homeDirectory)
        let source = try PublicSkillInstallRequest(catalogID: "owner/repo:example",
            repositorySlug: "owner/repo", skillMDPath: "skills/example/SKILL.md")
        let fetcher = GitPublicSkillPackageFetcher(temporaryRoot: repository.temporaryRoot,
            remoteURL: { _ in repository.repositoryRoot })
        let a = try await fetcher.resolvePackage(source)
        let first = try await installer.preparePublicInstall(source, package: a, filesystemPaths: paths)
        #expect(first.action == .install)
        await installer.cancelPublicInstall(reviewID: first.id)
        #expect(!FileManager.default.fileExists(atPath: managed.path))
        #expect(try FileManager.default.contentsOfDirectory(atPath: paths.homeDirectory.path).isEmpty)
        let approved = try await installer.preparePublicInstall(source, package: a, filesystemPaths: paths)
        #expect(try await installer.applyPublicInstall(reviewID: approved.id) == .install)
        let target = paths.codexSkillsRoot.appendingPathComponent(source.targetName)
        let originalLink = try FileManager.default.destinationOfSymbolicLink(atPath: target.path)
        let record = URL(fileURLWithPath: originalLink).deletingLastPathComponent().appendingPathComponent("provenance.json")
        let originalRecord = try Data(contentsOf: record)

        guard case .enabled(let reopenedRoot, _) = AppRuntimeConfiguration.f1Mode(info: info, debugAllowed: true) else {
            Issue.record("Installed test configuration was rejected"); return
        }
        #expect(reopenedRoot == root)
        let reopenedPaths = SkillFilesystemPaths.isolated(testRoot: reopenedRoot)
        let restarted = ManagedSkillInstaller(managedRoot: reopenedRoot.appendingPathComponent("managed"),
            pathAnchor: reopenedPaths.homeDirectory)
        let repeated = try await restarted.preparePublicInstall(source, package: a, filesystemPaths: reopenedPaths)
        #expect(repeated.action == .unchanged)
        #expect(try await restarted.applyPublicInstall(reviewID: repeated.id) == .unchanged)
        #expect(try FileManager.default.destinationOfSymbolicLink(atPath: target.path) == originalLink)
        #expect(try Data(contentsOf: record) == originalRecord)

        try repository.advanceHead()
        let b = try await fetcher.resolvePackage(source)
        let update = try await restarted.preparePublicInstall(source, package: b, filesystemPaths: reopenedPaths)
        #expect(update.action == .update)
        #expect(update.changes.map(\.path) == ["SKILL.md"])
        #expect(try await restarted.applyPublicInstall(reviewID: update.id) == .update)
        for entry in b.entries {
            #expect(try Data(contentsOf: target.appendingPathComponent(entry.path)) == entry.data)
        }
        let provenance = try #require(SkillInstallProvenanceStore.read(targetRoot: reopenedPaths.codexSkillsRoot,
            targetName: source.targetName))
        #expect(provenance.commitSha == b.coordinates.commitSha)
        #expect(provenance.treeSha == b.coordinates.treeSha)
    }

    @Test func productionDefaultsRemainDisabled() {
        #expect(AppRuntimeConfiguration.f1Mode(info: [:], debugAllowed: true) == .disabled)
        #expect(AppRuntimeConfiguration.f1Mode(info: ["CFBundleIdentifier": "com.jonslimak.omgskills"], debugAllowed: false) == .disabled)
    }

    @Test func coldLaunchUsesBundleMetadataAndRejectsIncompleteOrReleaseConfig() throws {
        let root = URL(fileURLWithPath: "/private/tmp/omgskills-f1-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let website = "http://127.0.0.1:5197/app/preview/unified/"
        let info: [String: Any] = ["CFBundleIdentifier": AppRuntimeConfiguration.f1BundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]],
            AppRuntimeConfiguration.f1RootKey: root.path, AppRuntimeConfiguration.f1WebsiteKey: website]
        #expect(AppRuntimeConfiguration.f1Mode(info: info, debugAllowed: true) == .enabled(root: root.resolvingSymlinksInPath(), website: URL(string: website)!))
        for key in info.keys {
            var incomplete = info
            incomplete.removeValue(forKey: key)
            guard case .invalid = AppRuntimeConfiguration.f1Mode(info: incomplete, debugAllowed: true) else {
                Issue.record("Incomplete test config fell back to production"); continue
            }
        }
        guard case .invalid = AppRuntimeConfiguration.f1Mode(info: info, debugAllowed: false) else {
            Issue.record("Release accepted F1 configuration"); return
        }
        for (key, value) in [
            (AppRuntimeConfiguration.f1RootKey, FileManager.default.homeDirectoryForCurrentUser.path),
            (AppRuntimeConfiguration.f1RootKey, "/private/tmp/omgskills-f1-missing/../other"),
            (AppRuntimeConfiguration.f1WebsiteKey, "https://omgskills.com/app/"),
            (AppRuntimeConfiguration.f1WebsiteKey, "http://user@localhost:5197/")
        ] {
            var invalid = info; invalid[key] = value
            guard case .invalid = AppRuntimeConfiguration.f1Mode(info: invalid, debugAllowed: true) else {
                Issue.record("Unsafe config accepted"); continue
            }
        }
    }

    @Test func redirectedTestRootIsStillRejected() throws {
        let fm = FileManager.default
        let destination = fm.temporaryDirectory.appendingPathComponent("f1-root-destination-" + UUID().uuidString)
        let redirected = URL(fileURLWithPath: "/private/tmp/omgskills-f1-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: destination, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: destination) }
        try fm.createSymbolicLink(at: redirected, withDestinationURL: destination)
        defer { try? fm.removeItem(at: redirected) }
        let info: [String: Any] = ["CFBundleIdentifier": AppRuntimeConfiguration.f1BundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": ["omgskills-f1"]]],
            AppRuntimeConfiguration.f1RootKey: redirected.path,
            AppRuntimeConfiguration.f1WebsiteKey: "http://127.0.0.1:5197/app/preview/unified/"]
        guard case .invalid = AppRuntimeConfiguration.f1Mode(info: info, debugAllowed: true) else {
            Issue.record("Redirected test root was accepted"); return
        }
    }

    @Test func f1StartupExitsBeforeProductionServices() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/omgskills/omgskillsApp.swift")
        let code = try String(contentsOf: file, encoding: .utf8)
        let start = try #require(code.range(of: "switch f1Mode"))
        let analytics = try #require(code.range(of: "Analytics.start()"))
        #expect(start.lowerBound < analytics.lowerBound)
        let branch = code[start.lowerBound..<analytics.lowerBound]
        #expect(branch.contains("PublicSkillInstallWindowController"))
        #expect(branch.contains("return"))
        #expect(!branch.contains("setupUpdater"))
        #expect(!branch.contains("ContentView"))
    }
}
