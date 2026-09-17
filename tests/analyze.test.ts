import { expect, test, describe } from "vitest";
import { detectAdvice, fleschKincaidGrade } from "../src/lib/legallens/safety";

describe("Analyze Safety Guardrails", () => {
  test("Flesch-Kincaid correctly scores complex legalese as high grade level", () => {
    const legalese = "Notwithstanding anything to the contrary contained herein, in the event that the lessee fails to fulfill the obligations stipulated in clause 4.2, the lessor reserves the right to terminate this agreement forthwith.";
    const score = fleschKincaidGrade(legalese);
    expect(score).toBeGreaterThan(12.0); // Should be college level or higher
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
