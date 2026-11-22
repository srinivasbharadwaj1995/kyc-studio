import { describe, expect, it } from "vitest";
import {
  gstinCheckDigit,
  isValidAadhaarLast4,
  isValidBankAccount,
  isValidEmail,
  isValidGstin,
  isValidIfsc,
  isValidMobile,
  isValidPan,
  isValidPincode,
} from "./india";

// `null` = valid. Each validator gets valid samples AND the typical mistakes users make.
const valid = (fn: (v: string) => string | null, values: string[]) => values.forEach((v) => expect(fn(v), v).toBeNull());
const invalid = (fn: (v: string) => string | null, values: string[]) => values.forEach((v) => expect(fn(v), v).not.toBeNull());

describe("PAN", () => {
  it("accepts valid PANs for different holder types", () => valid(isValidPan, ["ABCPD1234E", "AAACR5055K", "AAAHA1234B"]));
  it("rejects wrong shapes", () => invalid(isValidPan, ["ABCPD1234", "ABCPD12345", "1BCPD1234E", "abcpd1234e", ""]));
  it("rejects an invalid holder type (4th char)", () => invalid(isValidPan, ["ABCDE1234F", "ABCXE1234F"]));
});

describe("GSTIN", () => {
  // Real, published GSTINs (checksums verified independently).
  const real = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "07AAGFF2194N1Z1"];

  it("accepts real GSTINs", () => valid(isValidGstin, real));

  it("computes the mod-36 check digit", () => {
    for (const g of real) expect(gstinCheckDigit(g.slice(0, 14))).toBe(g[14]);
  });

  it("catches a single-character typo via the checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZW")).toMatch(/checksum/); // last char changed
    expect(isValidGstin("27AAPFU0938F1ZV")).toMatch(/checksum/); // one digit changed inside
  });

  it("rejects an invalid state code", () => {
    expect(isValidGstin("45AAPFU0939F1ZV")).toMatch(/state code/);
    expect(isValidGstin("00AAPFU0939F1ZV")).toMatch(/state code/);
  });

  it("rejects when the embedded PAN is invalid", () => {
    // Embedded PAN "AAPXU0939F": 4th char X is not a valid holder type.
    expect(isValidGstin("27AAPXU0939F1ZV")).toMatch(/valid PAN/);
  });

  it("rejects wrong shapes", () => invalid(isValidGstin, ["27AAPFU0939F1V", "27AAPFU0939F1AV", "27AAPFU0939F0ZV", ""]));
});

describe("IFSC", () => {
  it("accepts valid codes", () => valid(isValidIfsc, ["HDFC0001234", "SBIN0000001", "ICIC0ABC123"]));
  it("rejects a missing 0 in 5th place or wrong length", () => invalid(isValidIfsc, ["HDFC1001234", "HDF00001234", "HDFC000123"]));
});

describe("mobile", () => {
  it("accepts 10 digits starting 6-9", () => valid(isValidMobile, ["9876543210", "6000000000"]));
  it("rejects +91, wrong start or length", () => invalid(isValidMobile, ["+919876543210", "5876543210", "987654321", "98765 43210"]));
});

describe("pincode", () => {
  it("accepts 6 digits not starting with 0", () => valid(isValidPincode, ["560001", "110011"]));
  it("rejects others", () => invalid(isValidPincode, ["056000", "56000", "5600011", "56000A"]));
});

describe("aadhaar last 4", () => {
  it("accepts exactly 4 digits", () => valid(isValidAadhaarLast4, ["1234", "0000"]));
  it("rejects full Aadhaar and others", () => invalid(isValidAadhaarLast4, ["123456789012", "123", "12a4"]));
});

describe("bank account", () => {
  it("accepts 9-18 digits", () => valid(isValidBankAccount, ["123456789", "123456789012345678"]));
  it("rejects too short, too long or non-digits", () => invalid(isValidBankAccount, ["12345678", "1234567890123456789", "12345678A"]));
});

describe("email", () => {
  it("accepts normal emails", () => valid(isValidEmail, ["asha@example.com", "a.b+kyc@bank.co.in"]));
  it("rejects obvious mistakes", () => invalid(isValidEmail, ["asha", "asha@", "asha@example", "a sha@example.com"]));
});

describe("ReDoS safety", () => {
  it("handles a huge hostile input instantly", () => {
    const evil = "A".repeat(100_000) + "!";
    const start = performance.now();
    for (const fn of [isValidPan, isValidGstin, isValidIfsc, isValidEmail]) fn(evil);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
