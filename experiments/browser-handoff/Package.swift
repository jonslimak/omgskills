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
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        .target(name: "HandoffCore"),
        .target(name: "HandoffTestSupport", dependencies: ["HandoffCore"]),
        .target(name: "HandoffUI", dependencies: ["HandoffCore"]),
        .target(name: "HelperUpdates", dependencies: ["HandoffCore", .product(name: "Sparkle", package: "Sparkle")]),
        .executableTarget(name: "OMGSkillsHelper", dependencies: ["HandoffCore", "HandoffUI", "HelperUpdates"],
                          linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .executableTarget(name: "OmgskillsHandoff", dependencies: ["HandoffCore", "HandoffTestSupport", "HandoffUI"]),
        .executableTarget(name: "HandoffInstallHarness", dependencies: ["HandoffTestSupport"]),
        .testTarget(name: "HandoffCoreTests", dependencies: ["HandoffCore", "HandoffTestSupport"]),
        .testTarget(name: "HelperUpdatesTests", dependencies: ["HandoffCore", "HelperUpdates"]),
    ]
)
