import Foundation
import HandoffCore

public enum InstallLaunchMode: Equatable, Sendable {
    case preview
    case sandbox(String, fixtures: Bool)
    case simulatedHome(String, fixtures: Bool)
    case realHome
    case realDiscovery(String)

    public static func parse(_ environment: [String: String]) throws -> Self {
        let sandbox = environment["OMGSKILLS_H1_INSTALL_ROOT"]
        let home = environment["OMGSKILLS_H13_TEST_HOME_ROOT"]
        let real = environment["OMGSKILLS_H13_REAL_INSTALLS"]
        let discovery = environment["OMGSKILLS_H13_DISCOVERY_ROOT"]
        let fixture = environment["OMGSKILLS_H12_FIXTURES"]
        guard [sandbox, home, real].compactMap({ $0 }).count <= 1,
              real == nil || real == "1", fixture == nil || fixture == "0" || fixture == "1" else {
            throw InstallFailure.unsafeRoot
        }
        if real != nil {
            guard fixture != "1" else { throw InstallFailure.unsafeRoot }
            if let discovery { return .realDiscovery(discovery) }
            return .realHome
        }
        guard discovery == nil else { throw InstallFailure.unsafeRoot }
        if let home { return .simulatedHome(home, fixtures: fixture == "1") }
        if let sandbox { return .sandbox(sandbox, fixtures: fixture == "1") }
        guard fixture != "1" else { throw InstallFailure.unsafeRoot }
        return .preview
    }

    public var isTest: Bool {
        switch self { case .realHome, .realDiscovery: false; default: true }
    }
    public var fixtures: Bool {
        switch self {
        case .sandbox(_, let fixtures), .simulatedHome(_, let fixtures): fixtures
        case .realDiscovery: true
        default: false
        }
    }

    @MainActor public func makeModel() throws -> InstallModel? {
        switch self {
        case .preview: return nil
        case .sandbox(let path, let fixtures):
            let service: any InstallServing = fixtures
                ? try FixtureInstallService(testRoot: path)
                : try PublicInstallService(testRoot: path)
            return InstallModel(service: service, requestPolicy: .test)
        case .simulatedHome(let path, let fixtures):
            let sandbox = try InstallSandbox(path: path)
            return try model(home: .simulated(in: sandbox), fixtureSandbox: fixtures ? sandbox : nil)
        case .realHome: return try model(home: .currentUser(), fixtureSandbox: nil)
        case .realDiscovery(let path):
            let control = try InstallSandbox(path: path)
            _ = try DiscoveryFixture.selected(in: control)
            let home = try UserInstallHome.currentUser()
            return InstallModel(codex: DiscoveryInstallService(home: home, agent: .codex, control: control),
                                claude: DiscoveryInstallService(home: home, agent: .claude, control: control), requestPolicy: .discovery)
        }
    }

    @MainActor private func model(home: UserInstallHome, fixtureSandbox: InstallSandbox?) -> InstallModel {
        if let fixtureSandbox {
            return InstallModel(codex: FixtureInstallService(home: home, agent: .codex, control: fixtureSandbox),
                                claude: FixtureInstallService(home: home, agent: .claude, control: fixtureSandbox), requestPolicy: .test)
        }
        return InstallModel(codex: PublicInstallService(home: home, agent: .codex),
                            claude: PublicInstallService(home: home, agent: .claude), requestPolicy: .test)
    }
}
