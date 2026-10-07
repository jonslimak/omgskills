// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "omgskills-browser-handoff",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OMGSkillsHelper", targets: ["OMGSkillsHelper"]),
        .executable(name: "OmgskillsHandoff", targets: ["OmgskillsHandoff"]),
        .executable(name: "HandoffInstallHarness", targets: ["HandoffInstallHarness"]),
    ],
    targets: [
        .target(name: "HandoffCore"),
        .target(name: "HandoffTestSupport", dependencies: ["HandoffCore"]),
        .target(name: "HandoffUI", dependencies: ["HandoffCore"]),
        .executableTarget(name: "OMGSkillsHelper", dependencies: ["HandoffCore", "HandoffUI"]),
        .executableTarget(name: "OmgskillsHandoff", dependencies: ["HandoffCore", "HandoffTestSupport", "HandoffUI"]),
        .executableTarget(name: "HandoffInstallHarness", dependencies: ["HandoffTestSupport"]),
        .testTarget(name: "HandoffCoreTests", dependencies: ["HandoffCore", "HandoffTestSupport"]),
    ]
)
