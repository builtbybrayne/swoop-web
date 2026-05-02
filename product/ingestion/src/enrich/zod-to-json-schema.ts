/**
 * Tiny Zod → JSON Schema (draft 2020-12) converter for tool input schemas.
 *
 * Targeted at classifier output shapes — objects with primitive + array
 * fields. Mirrors the orchestrator's normalisation in `claude-llm.ts` but
 * lives here as a small standalone helper to keep the workspace boundary
 * clean (per the C.t3a plan §"haiku.ts" — does NOT import from the
 * orchestrator workspace).
 *
 * If a future classifier shape needs anyOf/oneOf, extend here. For now
 * we support: ZodObject, ZodString, ZodNumber, ZodInt, ZodBoolean, ZodArray,
 * ZodEnum, ZodOptional, ZodNullable, ZodDefault.
 */

import { ZodTypeAny } from 'zod';

interface JsonSchemaFragment {
  type?: string;
  properties?: Record<string, JsonSchemaFragment>;
  required?: string[];
  items?: JsonSchemaFragment;
  enum?: ReadonlyArray<string | number>;
  description?: string;
  additionalProperties?: boolean;
  // Allow a passthrough so unrecognised types don't crash conversion.
  [key: string]: unknown;
}

interface ZodInternalDef {
  typeName?: string;
  shape?: () => Record<string, ZodTypeAny>;
  type?: ZodTypeAny;
  innerType?: ZodTypeAny;
  values?: readonly string[];
  description?: string;
  defaultValue?: () => unknown;
}

function zodDef(schema: ZodTypeAny): ZodInternalDef {
  // Zod attaches its definition under `_def`. We type it loosely — Zod's
  // internal type is private but stable enough for classifier-shape needs.
  // This is the same accommodation made by zod-to-json-schema upstream.
  return (schema as unknown as { _def: ZodInternalDef })._def;
}

export function zodToToolInputSchema(schema: ZodTypeAny): object {
  return zodToFragment(schema, true);
}

function zodToFragment(schema: ZodTypeAny, topLevel = false): JsonSchemaFragment {
  const def = zodDef(schema);
  const typeName = def.typeName;

  switch (typeName) {
    case 'ZodObject': {
      const out: JsonSchemaFragment = {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      };
      const shapeFn = def.shape;
      const shape: Record<string, ZodTypeAny> = typeof shapeFn === 'function' ? shapeFn() : {};
      for (const [key, child] of Object.entries(shape)) {
        out.properties![key] = zodToFragment(child);
        const childDef = zodDef(child);
        const optional =
          childDef.typeName === 'ZodOptional' ||
          childDef.typeName === 'ZodNullable' ||
          childDef.typeName === 'ZodDefault';
        if (!optional) out.required!.push(key);
      }
      if (out.required!.length === 0) delete out.required;
      if (topLevel && def.description) out.description = def.description;
      return out;
    }
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return zodToFragment(def.innerType as ZodTypeAny);
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: zodToFragment(def.type as ZodTypeAny) };
    case 'ZodEnum':
      return { type: 'string', enum: [...(def.values ?? [])] };
    case 'ZodLiteral': {
      const v = (def as unknown as { value: unknown }).value;
      const t = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
      return { type: t, enum: [v as string | number] };
    }
    case 'ZodUnion': {
      // Best-effort: pick the first option's shape. Classifier outputs
      // shouldn't need unions; flag in dev if used.
      const options = (def as unknown as { options: ZodTypeAny[] }).options ?? [];
      if (options.length > 0) return zodToFragment(options[0]!);
      return {};
    }
    default:
      // Unknown type — return an empty shape rather than crashing. The
      // classifier prompt is the safety net.
      return {};
  }
}
