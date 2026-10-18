// FLAWED on purpose (eval self-check): the ellipsis goes into the shared truncate(), which silently changes headline().
export const truncate = (text, len) => (text.length <= len ? text : text.slice(0, len - 1) + '…');
