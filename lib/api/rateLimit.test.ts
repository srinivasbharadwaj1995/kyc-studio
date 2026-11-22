import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry time", () => {
    const check = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(check("ip", 0).ok).toBe(true);
    expect(check("ip", 1000).ok).toBe(true);
    expect(check("ip", 2000).ok).toBe(true);
    expect(check("ip", 3000)).toEqual({ ok: false, retryAfterSeconds: 57 }); // first hit expires at 60s
  });

  it("frees up as old hits leave the window (sliding, not fixed)", () => {
    const check = createRateLimiter({ limit: 2, windowMs: 60_000 });
    check("ip", 0);
    check("ip", 30_000);
    expect(check("ip", 59_999).ok).toBe(false);
    expect(check("ip", 60_000).ok).toBe(true); // the hit at 0 has expired
  });

  it("tracks each client separately", () => {
    const check = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(check("a", 0).ok).toBe(true);
    expect(check("b", 0).ok).toBe(true);
    expect(check("a", 1).ok).toBe(false);
  });
});
