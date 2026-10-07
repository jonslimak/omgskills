import HandoffCore
import HandoffTestSupport
import XCTest

final class HandoffRequestTests: XCTestCase {
    private let valid = "omgskills-helper-test://install?id=anthropics%2Fskills%3Askills%2Ffrontend-design"

    func testValidPublicFixture() {
        XCTAssertEqual(HandoffRequest.parseTest(valid)?.skillID, HandoffRequest.testSkillID)
    }

    func testRejectsUntrustedInputs() {
        let invalid = [
            "omgskills://install?id=anthropics%2Fskills%3Askills%2Ffrontend-design",
            "omgskills-helper-test://remove?id=anthropics%2Fskills%3Askills%2Ffrontend-design",
            "omgskills-helper-test://install?id=unknown%2Frepo%3Askill",
            valid + "&id=anthropics%2Fskills%3Askills%2Ffrontend-design",
            valid + "&url=https://example.com/package.zip",
            valid + "#fragment",
            "omgskills-helper-test://install?id=%ZZ",
            "omgskills-helper-test://install?id=/Users/test/SKILL.md",
            "omgskills-helper-test://install?id=https://example.com/skill",
            "omgskills-helper-test://install@evil.example?id=anthropics%2Fskills%3Askills%2Ffrontend-design",
            valid + String(repeating: "a", count: 513),
        ]
        for input in invalid {
            XCTAssertNil(HandoffRequest.parseTest(input), input)
            XCTAssertNil(HandoffRequest.parse(input.replacingOccurrences(of: "omgskills-helper-test:", with: "omgskills-helper:")), input)
        }
    }
}
