import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { encrypt, decrypt } from '../lib/crypto.js'
import { NotFoundError, ConflictError, ValidationError } from '../plugins/errors.js'
import {
  getAccountingConnector,
  getMessagingConnector,
  isAccountingProvider,
  isMessagingProvider,
} from '../connectors/index.js'
import type { ConnectorCredentials } from '../connectors/index.js'

const ProviderEnum = Type.Union([
  Type.Literal('zoho_books'),
  Type.Literal('tally'),
  Type.Literal('whatsapp'),
  Type.Literal('gmail'),
  Type.Literal('google_sheets'),
])

// Never includes credentials_encrypted — those stay server-side only.
const ConnectedAccountSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  business_id: Type.String({ format: 'uuid' }),
  provider: ProviderEnum,
  metadata: Type.Record(Type.String(), Type.Unknown()),
  is_active: Type.Boolean(),
  last_synced_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
})

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

const CreateBody = Type.Object({
  provider: ProviderEnum,
  credentials: Type.Record(Type.String(), Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const TestConnectionResponse = Type.Object({
  ok: Type.Boolean(),
  message: Type.String(),
})

export const connectedAccountsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  app.get(
    '/connected-accounts',
    {
      ...auth,
      schema: { response: { 200: Type.Array(ConnectedAccountSchema) } },
    },
    async (req) => {
      const { data, error } = await req.supabase
        .from('connected_accounts')
        .select(
          'id, business_id, provider, metadata, is_active, last_synced_at, created_at, updated_at'
        )
        .eq('business_id', req.businessId)
        .order('created_at', { ascending: true })

      if (error) throw new Error(error.message)
      return data ?? []
    }
  )

  app.post(
    '/connected-accounts',
    {
      ...auth,
      schema: { body: CreateBody, response: { 201: ConnectedAccountSchema } },
    },
    async (req, reply) => {
      const { provider, credentials, metadata } = req.body as {
        provider: string
        credentials: ConnectorCredentials
        metadata?: Record<string, unknown>
      }

      if (Object.keys(credentials).length === 0) {
        throw new ValidationError('credentials must not be empty')
      }

      const credentials_encrypted = encrypt(JSON.stringify(credentials))

      const { data, error } = await req.supabase
        .from('connected_accounts')
        .insert({
          business_id: req.businessId,
          provider,
          credentials_encrypted,
          metadata: metadata ?? {},
        })
        .select(
          'id, business_id, provider, metadata, is_active, last_synced_at, created_at, updated_at'
        )
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new ConflictError(`A ${provider} connection already exists for this business`)
        }
        throw new Error(error.message)
      }

      return reply.status(201).send(data)
    }
  )

  app.delete(
    '/connected-accounts/:id',
    {
      ...auth,
      schema: { params: IdParam, response: { 204: Type.Null() } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }

      const { data, error } = await req.supabase
        .from('connected_accounts')
        .delete()
        .eq('id', id)
        .eq('business_id', req.businessId)
        .select('id')
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new NotFoundError('ConnectedAccount', id)

      return reply.status(204).send()
    }
  )

  app.post(
    '/connected-accounts/:id/test',
    {
      ...auth,
      schema: { params: IdParam, response: { 200: TestConnectionResponse } },
    },
    async (req) => {
      const { id } = req.params as { id: string }

      const { data, error } = await req.supabase
        .from('connected_accounts')
        .select('id, provider, credentials_encrypted')
        .eq('id', id)
        .eq('business_id', req.businessId)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new NotFoundError('ConnectedAccount', id)
      if (!data.credentials_encrypted) {
        return { ok: false, message: 'No credentials stored for this connection' }
      }

      const credentials = JSON.parse(decrypt(data.credentials_encrypted)) as ConnectorCredentials
      const provider = data.provider as Parameters<typeof getAccountingConnector>[0]

      if (isAccountingProvider(provider)) {
        return getAccountingConnector(provider, credentials).testConnection()
      }
      if (isMessagingProvider(provider)) {
        return getMessagingConnector(provider, credentials).testConnection()
      }

      throw new ValidationError(`Unknown provider: ${provider}`)
    }
  )
}
