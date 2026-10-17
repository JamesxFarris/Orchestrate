/** Upper-case the first letter. */
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "  Hello, World!  " -> "hello-world" */
export const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
