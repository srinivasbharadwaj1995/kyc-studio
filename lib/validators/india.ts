import type { FieldType } from "@/lib/schema/types";

/**
 * Indian document validators. These live in OUR code, never in the AI's output:
 * the AI only picks a field's TYPE, and the type decides which validator runs.
 * So a hallucination can't produce a wrong or dangerous regex.
 *
 * Every regex is anchored (^...$) with no nested quantifiers, so it runs in
 * linear time: no ReDoS risk, whatever the user types.
 *
 * Each validator gets a trimmed, uppercased-where-relevant string and returns
 * an error message, or null if valid.
 */

type Validator = (value: string) => string | null;

// 4th character of a PAN = holder type: P person, C company, H HUF, F firm,
// A AOP, T trust, B BOI, L local authority, J artificial juridical person, G government.
const PAN_RE = /^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/; // 4-letter bank code, a 0, 6-char branch code
const MOBILE_RE = /^[6-9][0-9]{9}$/; // Indian mobiles start with 6-9
const PINCODE_RE = /^[1-9][0-9]{5}$/; // pincodes never start with 0
const AADHAAR_LAST4_RE = /^[0-9]{4}$/;
const BANK_ACCOUNT_RE = /^[0-9]{9,18}$/; // Indian account numbers are 9-18 digits
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // deliberately simple; real check = sending a mail
// GSTIN = state code (2) + PAN (10) + entity number (1) + "Z" + checksum (1)
const GSTIN_RE = /^([0-9]{2})([A-Z0-9]{10})([1-9A-Z])Z([0-9A-Z])$/;

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Valid GST state codes: 01-38 (states/UTs), 97 (other territory), 99 (centre jurisdiction). */
function isValidStateCode(code: number): boolean {
  return (code >= 1 && code <= 38) || code === 97 || code === 99;
}

/**
 * The 15th GSTIN character is a mod-36 check digit over the first 14.
 * Each char's value (0-9, A=10 ... Z=35) is multiplied by 1 or 2 alternately;
 * the product's base-36 digits are summed; the check digit makes the sum divisible by 36.
 * This catches single typos and most swapped neighbouring characters.
 */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export const isValidPan: Validator = (v) => (PAN_RE.test(v) ? null : "Enter a valid PAN, e.g. ABCPD1234E");

export const isValidGstin: Validator = (v) => {
  const match = GSTIN_RE.exec(v);
  if (!match) return "Enter a valid 15-character GSTIN";
  const [, state, pan] = match;
  if (!isValidStateCode(Number(state))) return "GSTIN starts with an invalid state code";
  if (!PAN_RE.test(pan!)) return "Characters 3-12 of a GSTIN must be a valid PAN";
  if (gstinCheckDigit(v.slice(0, 14)) !== v[14]) return "This GSTIN has a typo (checksum doesn't match)";
  return null;
};

export const isValidIfsc: Validator = (v) => (IFSC_RE.test(v) ? null : "Enter a valid IFSC, e.g. HDFC0001234");
export const isValidMobile: Validator = (v) => (MOBILE_RE.test(v) ? null : "Enter a 10-digit mobile number starting with 6-9");
export const isValidPincode: Validator = (v) => (PINCODE_RE.test(v) ? null : "Enter a valid 6-digit pincode");
export const isValidAadhaarLast4: Validator = (v) => (AADHAAR_LAST4_RE.test(v) ? null : "Enter exactly 4 digits");
export const isValidBankAccount: Validator = (v) => (BANK_ACCOUNT_RE.test(v) ? null : "Account number must be 9-18 digits");
export const isValidEmail: Validator = (v) => (EMAIL_RE.test(v) ? null : "Enter a valid email address");

/** Field type → validator. Types not listed (text, date, select…) need no format check. */
export const FORMAT_VALIDATORS: Partial<Record<FieldType, Validator>> = {
  pan: isValidPan,
  gstin: isValidGstin,
  ifsc: isValidIfsc,
  mobile: isValidMobile,
  pincode: isValidPincode,
  aadhaar_last4: isValidAadhaarLast4,
  bank_account: isValidBankAccount,
  email: isValidEmail,
};

/**
 * The raw regexes, for the code exporter. The exported component gets the SAME
 * patterns as the app, read from here, never retyped by hand.
 */
export const PATTERNS = {
  pan: PAN_RE,
  ifsc: IFSC_RE,
  mobile: MOBILE_RE,
  pincode: PINCODE_RE,
  aadhaar_last4: AADHAAR_LAST4_RE,
  bank_account: BANK_ACCOUNT_RE,
  email: EMAIL_RE,
  gstin: GSTIN_RE,
} as const;

/** Types whose value is compared in uppercase (users often type pan in lowercase). */
export const UPPERCASE_TYPES: ReadonlySet<FieldType> = new Set(["pan", "gstin", "ifsc"]);
