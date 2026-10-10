import { z } from 'zod'

// Entity map (Total Recall step 2a). Shared by the list_entities / get_entity
// MCP tools and GET /api/v1/kairos/entities[/id] (entities-parity.test.ts).

export const ENTITY_KINDS = ['person', 'project', 'repo', 'app', 'tool', 'dominion', 'concept'] as const
export const entityKindSchema = z.enum(ENTITY_KINDS)

export const ENTITY_LIST_MAX = 200
export const ENTITY_MENTIONS_MAX = 50

const intParam = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback)

export const listEntitiesSchema = z.object({
  kind: entityKindSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: intParam(1, ENTITY_LIST_MAX, 50),
})

export const getEntitySchema = z.object({
  id: z.string().trim().min(1).max(200),
  mentions: intParam(0, ENTITY_MENTIONS_MAX, 10),
})

export type ListEntitiesInput = z.infer<typeof listEntitiesSchema>
export type GetEntityInput = z.infer<typeof getEntitySchema>
