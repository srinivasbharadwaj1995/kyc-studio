import type { FormSchema } from "./types";

/**
 * A hand-written, valid schema. Used by tests today and by the renderer
 * on Tuesday, before the AI is wired in.
 */
export const samplePersonalLoan: FormSchema = {
  name: "Personal loan KYC",
  purpose: "Verify identity and income to assess a personal loan application",
  steps: [
    {
      id: "basic_details",
      title: "Basic details",
      fields: [
        { id: "full_name", type: "text", label: "Full name", required: true, rules: { min: 2, max: 80 } },
        { id: "dob", type: "date", label: "Date of birth", required: true },
        { id: "mobile", type: "mobile", label: "Mobile number", required: true },
      ],
    },
    {
      id: "identity",
      title: "Identity",
      fields: [
        { id: "kyc_consent", type: "consent", label: "I agree to share my PAN and Aadhaar for KYC", required: true },
        { id: "pan_number", type: "pan", label: "PAN", required: true, sensitive: true },
        { id: "aadhaar_last4", type: "aadhaar_last4", label: "Last 4 digits of Aadhaar", required: true, sensitive: true },
      ],
    },
    {
      id: "income",
      title: "Income and bank",
      fields: [
        {
          id: "employment_type",
          type: "radio",
          label: "Employment type",
          required: true,
          options: [
            { label: "Salaried", value: "salaried" },
            { label: "Self-employed", value: "self_employed" },
          ],
        },
        {
          id: "gstin",
          type: "gstin",
          label: "GSTIN",
          required: true,
          showIf: { fieldId: "employment_type", equals: "self_employed" },
        },
        { id: "monthly_income", type: "number", label: "Monthly income (₹)", required: true, rules: { min: 0 } },
        { id: "ifsc", type: "ifsc", label: "Bank IFSC", required: true },
        { id: "account_number", type: "bank_account", label: "Bank account number", required: true, sensitive: true },
      ],
    },
  ],
};
