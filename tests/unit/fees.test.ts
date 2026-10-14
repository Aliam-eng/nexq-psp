import { describe, expect, it } from "vitest";
import { computeFee, computeTotal, round2 } from "@/lib/fees";

describe("fees", () => {
  it("charges no fee today", () => {
    expect(computeFee(250)).toBe(0);
    expect(computeTotal(250)).toBe(250);
  });

  it("returns 0 fee for invalid amounts", () => {
    for (const v of [0, -5, NaN, Infinity]) expect(computeFee(v)).toBe(0);
  });

  it("total is always rounded to cents", () => {
    expect(computeTotal(10.005)).toBe(10.01);
    expect(computeTotal(0.1 + 0.2)).toBe(0.3);
  });

  it("round2 handles floating-point edge cases", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(99.999)).toBe(100);
  });
});
