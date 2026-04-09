import { StateSchema } from './types.js';

type SchemaWithIndex = Pick<StateSchema, 'index' | 'offset'>;

export const getSchemaIndex = (schema: SchemaWithIndex | null | undefined): number | undefined => {
  if (!schema) return undefined;
  if (schema.index !== undefined) return schema.index;
  return schema.offset;
};

export const hasExplicitSchemaIndex = (schema: SchemaWithIndex | null | undefined): boolean =>
  getSchemaIndex(schema) !== undefined;
