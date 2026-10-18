/** Tokens a session used, split the way the API bills them. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The token fields the API reports on a message or a whole session (any may be missing or null). */
export interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export const tokensOf = (u: ApiUsage | undefined): TokenUsage => ({
  input: u?.input_tokens ?? 0,
  output: u?.output_tokens ?? 0,
  cacheRead: u?.cache_read_input_tokens ?? 0,
  cacheWrite: u?.cache_creation_input_tokens ?? 0,
});

/** How much context one model request carried: its whole prompt, cached or not. */
export const contextOf = (u: ApiUsage | undefined): number => (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);

/** Every token a session read or wrote. */
export const totalTokens = (t: TokenUsage): number => t.input + t.output + t.cacheRead + t.cacheWrite;
