import { describe, expect, it } from "vitest";
import { validateField } from "./validateField";
import type { Field } from "@/lib/schema/types";

const field = (overrides: Partial<Field>): Field => ({
  id: "f",
  type: "text",
  label: "Full name",
  required: false,
  ...overrides,
});

describe("validateField", () => {
  it("requires a value when required", () => {
    expect(validateField(field({ required: true }), "")).toBe("Full name is required");
    expect(validateField(field({ required: true }), "   ")).toBe("Full name is required");
    expect(validateField(field({ required: true }), "Asha")).toBe(true);
  });

  it("allows empty optional fields, even with rules", () => {
    expect(validateField(field({ rules: { min: 3 } }), "")).toBe(true);
  });

  it("uses friendly required messages for consent and choices", () => {
    expect(validateField(field({ type: "consent", required: true }), false)).toBe("You must agree to continue");
    expect(validateField(field({ type: "radio", required: true }), null)).toBe("Please choose an option");
    expect(validateField(field({ type: "consent", required: true }), true)).toBe(true);
  });

  it("treats min/max as length for text", () => {
    const f = field({ rules: { min: 2, max: 5 } });
    expect(validateField(f, "A")).toBe("Must be at least 2 characters");
    expect(validateField(f, "Abcdef")).toBe("Must be at most 5 characters");
    expect(validateField(f, "Abc")).toBe(true);
  });

  it("treats min/max as value for numbers", () => {
    const f = field({ type: "number", rules: { min: 0, max: 100 } });
    expect(validateField(f, "-1")).toBe("Must be at least 0");
    expect(validateField(f, "101")).toBe("Must be at most 100");
    expect(validateField(f, "abc")).toBe("Enter a valid number");
    expect(validateField(f, "50")).toBe(true);
  });

  it("runs the Indian format validator chosen by field type", () => {
    expect(validateField(field({ type: "pan" }), "ABCDE1234F")).toMatch(/valid PAN/);
    expect(validateField(field({ type: "pan" }), "abcpd1234e")).toBe(true); // lowercase is normalised
    expect(validateField(field({ type: "gstin" }), "27AAPFU0939F1ZW")).toMatch(/checksum/);
    expect(validateField(field({ type: "mobile" }), "5876543210")).toMatch(/6-9/);
  });

  it("prefers the schema's custom message", () => {
    const f = field({ rules: { min: 2, message: "Too short" } });
    expect(validateField(f, "A")).toBe("Too short");
  });
});
