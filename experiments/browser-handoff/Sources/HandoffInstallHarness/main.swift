import Foundation
import HandoffTestSupport

@main
struct Harness {
    static func main() async {
        do { print(try await InstallHarness.run(Array(CommandLine.arguments.dropFirst()))) }
        catch { try? FileHandle.standardError.write(contentsOf: Data("\(error.localizedDescription)\n".utf8)); exit(1) }
    }
}
