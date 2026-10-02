import { describe, expect, it } from "vitest";
import { FixedWindowLimiter, getSharedLimiter } from "./rate-limit";

const MINUTE = 60_000;

describe("FixedWindowLimiter", () => {
  it("allows up to the limit and then rejects within one window", () => {
    const limiter = new FixedWindowLimiter();

    expect(limiter.take("a", 2, MINUTE, 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
      resetAt: MINUTE,
    });
    expect(limiter.take("a", 2, MINUTE, 2_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.take("a", 2, MINUTE, 3_000)).toMatchObject({
      allowed: false,
      remaining: 0,
      resetAt: MINUTE,
    });
  });

  it("resets when the next window starts", () => {
    const limiter = new FixedWindowLimiter();
    limiter.take("a", 1, MINUTE, 59_999);

    expect(limiter.take("a", 1, MINUTE, 59_999).allowed).toBe(false);
    expect(limiter.take("a", 1, MINUTE, MINUTE).allowed).toBe(true);
  });

  it("keeps buckets and window sizes independent", () => {
    const limiter = new FixedWindowLimiter();
    limiter.take("a", 1, MINUTE, 0);

    expect(limiter.take("b", 1, MINUTE, 0).allowed).toBe(true);
    expect(limiter.take("a", 1, 24 * 60 * MINUTE, 0).allowed).toBe(true);
  });

  it("stays within its capacity when many buckets appear", () => {
    const limiter = new FixedWindowLimiter(10);
    for (let index = 0; index < 50; index += 1) {
      limiter.take(`bucket-${index}`, 1, MINUTE, index);
    }

    expect(limiter.size).toBeLessThanOrEqual(10);
  });

  it("drops finished windows before evicting live ones", () => {
    const limiter = new FixedWindowLimiter(2);
    limiter.take("old", 1, MINUTE, 0);
    limiter.take("live", 1, MINUTE, MINUTE);
    limiter.take("new", 1, MINUTE, MINUTE + 1);

    expect(limiter.take("live", 1, MINUTE, MINUTE + 2).allowed).toBe(false);
  });
});

describe("getSharedLimiter", () => {
  it("returns the same instance on every call", () => {
    expect(getSharedLimiter()).toBe(getSharedLimiter());
  });
});
