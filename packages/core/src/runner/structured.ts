import { z } from 'zod';
import type { AgentResult } from './types.ts';

const UNSUPPORTED = new Set(['$schema', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'exclusiveMinimum', 'exclusiveMaximum', 'minimum', 'maximum', 'format']);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!UNSUPPORTED.has(k)) out[k] = strip(v);
    }
    return out;
  }
  return node;
}

/**
 * JSON schema for structured output. Constraints the model-side validator may not support are
 * stripped; the zod schema re-validates the answer afterwards, so nothing is lost.
 */
export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseStructured<T>(schema: z.ZodType<T>, result: AgentResult): Parsed<T> {
  const raw = result.structured ?? extractJson(result.text);
  if (raw === undefined) return { ok: false, error: result.error ?? 'agent returned no structured output' };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: parsed.data };
}
