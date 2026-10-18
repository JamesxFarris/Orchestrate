import { truncate } from './text.js';

/** A report headline for the dashboard tiles: the title, cut to the tile's 20 characters. */
export const headline = (title) => truncate(title.trim(), 20);
