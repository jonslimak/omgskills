// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "omgskills-browser-handoff",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "OmgskillsHandoff", targets: ["OmgskillsHandoff"])],
    targets: [
        .target(name: "HandoffCore"),
        .executableTarget(name: "OmgskillsHandoff", dependencies: ["HandoffCore"]),
        .testTarget(name: "HandoffCoreTests", dependencies: ["HandoffCore"]),
    ]
)
