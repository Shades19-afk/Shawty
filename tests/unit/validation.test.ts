import { describe, expect, it } from "vitest";
import { isValidCustomCode } from "../../src/validation";

describe("isValidCustomCode", () => {
  it.each(["abc", "a".repeat(20), "my-link_123"])(
    "accepts valid code %s",
    (code) => {
      expect(isValidCustomCode(code)).toBe(true);
    },
  );

  it.each(["ab", "a".repeat(21), "", "my link", "my/link", "my?link", "my.link", "my-😀"])(
    "rejects invalid code %s",
    (code) => {
      expect(isValidCustomCode(code)).toBe(false);
    },
  );

  it("rejects undefined and null", () => {
    expect(isValidCustomCode(undefined)).toBe(false);
    expect(isValidCustomCode(null)).toBe(false);
  });
});
