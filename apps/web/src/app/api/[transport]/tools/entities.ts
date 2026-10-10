import { getEntity, listEntities } from '@/lib/data/entities/queries'
import { getEntitySchema, listEntitiesSchema } from '@/lib/data/validators/entities'
import type { RegisterFn } from './types'
import { getUserId, ok, fail, notFound } from './types'

// The owner's entity map (Total Recall step 2a): read-only. Mirrors
// GET /api/v1/kairos/entities and /entities/[id] (entities-parity.test.ts).

const LIST_SHAPE = listEntitiesSchema.shape
const GET_SHAPE = getEntitySchema.shape

export const registerEntityTools: RegisterFn = (server) => {
  server.tool(
    'list_entities',
    "The owner's entity map: people, boards, repos and Dominions Vorath recognises, with alias and mention counts, most mentioned first. Filter by kind or a name fragment. Read-only.",
    {
      kind: LIST_SHAPE.kind.describe('person, project, repo, app, tool, dominion or concept'),
      q: LIST_SHAPE.q.describe('Name or alias fragment'),
      limit: LIST_SHAPE.limit.describe('Max entities (1-200, default 50)'),
    },
    { title: 'List Entities', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listEntitiesSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const list = await listEntities(uid, parsed.data)
      return ok({ count: list.length, entities: list })
    }
  )

  server.tool(
    'get_entity',
    'One entity from the owner\'s map by UUID or by name/alias: its aliases and the live memories that mention it (fk = filed under it, dict = named in the text). Read-only.',
    {
      id: GET_SHAPE.id.describe('Entity UUID, or a name / alias such as "Wraith"'),
      mentions: GET_SHAPE.mentions.describe('How many mentioning memories to include (0-50, default 10)'),
    },
    { title: 'Get Entity', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getEntitySchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const entity = await getEntity(uid, parsed.data)
      if (!entity) return notFound('Entity')
      return ok(entity)
    }
  )
}
