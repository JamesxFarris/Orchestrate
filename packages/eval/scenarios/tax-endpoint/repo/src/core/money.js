/** 1234 -> "$12.34" */
export const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
