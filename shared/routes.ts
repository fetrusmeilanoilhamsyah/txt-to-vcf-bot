import { z } from 'zod';
import { conversionConfigSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  convert: {
    method: 'POST' as const,
    path: '/api/convert',
    // Input is FormData (file + config), so we don't strictly enforce schema here for body parsing middleware
    // but we use the schema for validation inside the route.
    responses: {
      200: z.any(), // File download
      400: errorSchemas.validation,
      500: errorSchemas.internal,
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
