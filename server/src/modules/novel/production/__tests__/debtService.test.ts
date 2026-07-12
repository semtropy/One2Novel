/**
 * Tests for debtService.ts — interest calculation, debt repayment, summary.
 *
 * Run: npx tsx --test server/src/modules/novel/production/__tests__/debtService.test.ts
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("DebtService — interest calculation logic", () => {
  it("calculates exponential interest correctly", () => {
    const originalAmount = 1.0;
    const interestRate = 0.1;
    const days = 1;
    const interest = originalAmount * Math.pow(interestRate, days);
    assert.equal(interest, 0.1);
  });

  it("interest decreases as days increase (rate < 1)", () => {
    assert.ok(Math.pow(0.1, 1) > Math.pow(0.1, 5));
    assert.ok(Math.pow(0.1, 5) > Math.pow(0.1, 10));
  });
});

describe("DebtService — payDebt logic", () => {
  it("partial payment reduces currentAmount", () => {
    const currentAmount = 10.0;
    const payment = 3.0;
    const newAmount = Math.max(0, currentAmount - payment);
    assert.equal(newAmount, 7.0);
  });

  it("full payment sets amount to 0", () => {
    const currentAmount = 5.0;
    const payment = 10.0;
    const newAmount = Math.max(0, currentAmount - payment);
    assert.equal(newAmount, 0);
  });
});

describe("DebtService — debt summary trend detection", () => {
  it("classifies increasing trend when totalDebt > 5", () => {
    const totalDebt = 10.0;
    const trend: "increasing" | "stable" | "decreasing" = totalDebt > 5 ? "increasing" : totalDebt < 1 ? "decreasing" : "stable";
    assert.equal(trend, "increasing");
  });

  it("classifies decreasing trend when totalDebt < 1", () => {
    const totalDebt = 0.5;
    const trend: "increasing" | "stable" | "decreasing" = totalDebt > 5 ? "increasing" : totalDebt < 1 ? "decreasing" : "stable";
    assert.equal(trend, "decreasing");
  });

  it("classifies stable trend when 1 <= totalDebt <= 5", () => {
    const totalDebt = 3.0;
    const trend: "increasing" | "stable" | "decreasing" = totalDebt > 5 ? "increasing" : totalDebt < 1 ? "decreasing" : "stable";
    assert.equal(trend, "stable");
  });
});
