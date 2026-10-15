/**
 * The system "reduce motion" setting, read once at load. Flashing and strobing effects become
 * steady when it is on; the information (which agent is blocked) stays, the flicker goes.
 */
export const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
