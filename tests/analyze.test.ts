import { expect, test, describe, it } from "vitest";
import { detectAdvice, fleschKincaidGrade } from "../src/lib/legallens/safety";

describe("Analyze Safety Guardrails", () => {
  it("Flesch-Kincaid correctly scores complex legalese as high grade level", () => {
    const score = fleschKincaidGrade("Notwithstanding any other provision herein to the contrary, the lessee shall indemnify and hold harmless the lessor from and against all actions, claims, demands, costs, damages, and expenses.");
    expect(score).toBeGreaterThan(10);
  });

  test("Flesch-Kincaid correctly scores plain language as low grade level", () => {
    const plainLanguage = "If you do not pay rent on time, the landlord can end your lease.";
    const score = fleschKincaidGrade(plainLanguage);
    expect(score).toBeLessThanOrEqual(8.0); // Should be easily readable
  });

  test("Advice detector catches explicit directives", () => {
    const badOutput = "You should definitely sign this contract, it is a good deal.";
    expect(detectAdvice(badOutput).isAdvice).toBe(true);
  });

  test("Advice detector allows informational explanations", () => {
    const safeOutput = "This clause means that the landlord can end the lease if rent is late.";
    expect(detectAdvice(safeOutput).isAdvice).toBe(false);
  });
});
