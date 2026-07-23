/**
 * Browser autofill policy for TPRO Classio.
 *
 * Saved credentials are intentionally available on the login form. Saved
 * email addresses are also useful on the two forms that start an OTP flow.
 * Every other form control uses the standards-based `autocomplete="off"`
 * signal at both form and field level. Keeping the tokens here avoids
 * browser-specific field-name tricks and makes new form audits predictable.
 */
export const savedInfoAutocomplete = {
  disabled: "off",
  loginIdentifier: "username",
  loginPassword: "current-password",
  otpEmail: "email",
  oneTimeCode: "one-time-code",
} as const;

export const noSavedInfoFormProps = {
  autoComplete: savedInfoAutocomplete.disabled,
} as const;

