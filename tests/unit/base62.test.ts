import { describe, expect, it } from "vitest";
import { encodeBase62 } from "../../src/base62";

describe("encodeBase62", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [61, "Z"],
    [62, "10"],
    [12345, "3d7"],
    [Number.MAX_SAFE_INTEGER, "FfGNdXsE7"],
  ])("encodes %s as %s", (input, expected) => {
    expect(encodeBase62(input)).toBe(expected);
  });

  it("is deterministic", () => {
    expect(encodeBase62(987654321)).toBe(encodeBase62(987654321));
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid input %s",
    (input) => {
      expect(() => encodeBase62(input)).toThrow();
    },
  );
});
