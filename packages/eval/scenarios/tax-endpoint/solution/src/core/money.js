/** 1234 -> "$12.34" */
export const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;

/** Price in cents with tax added, rounded half up to whole cents. */
export const priceWithTax = (cents, rate) => Math.floor(cents * (1 + rate) + 0.5);
