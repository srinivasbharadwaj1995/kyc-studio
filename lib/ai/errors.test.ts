import { describe, expect, it } from "vitest";
import { toFriendlyError } from "./errors";

describe("toFriendlyError", () => {
  it("maps Gemini 'high demand' (seen in real testing) to 503 + retry advice", () => {
    const retryError = { message: "Failed after 2 attempts", lastError: { message: "This model is currently experiencing high demand." } };
    expect(toFriendlyError(retryError)).toEqual({ status: 503, message: expect.stringMatching(/busy/) });
  });

  it("maps quota errors to 429", () => {
    expect(toFriendlyError({ statusCode: 429, message: "Resource exhausted" }).status).toBe(429);
  });

  it("maps a retired model (seen in real testing) to a config hint", () => {
    const e = { message: "This model models/gemini-2.5-flash is no longer available to new users." };
    expect(toFriendlyError(e).message).toMatch(/GEMINI_MODEL/);
  });

  it("never leaks the raw error message", () => {
    const e = { message: "AI_APICallError: internal stack trace with secrets" };
    expect(toFriendlyError(e)).toEqual({ status: 502, message: "The AI service failed. Please retry." });
    expect(toFriendlyError(undefined).status).toBe(502);
  });
});
