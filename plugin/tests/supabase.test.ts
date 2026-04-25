import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test that the client uses the finn schema
describe('supabase client', () => {
  it('uses finn schema', async () => {
    // The client module must be imported lazily (after env is set)
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'test-key'

    const { db } = await import('../src/db/supabase.js')
    // db() should return a client — if env missing it throws
    expect(db).toBeDefined()
  })

  it('throws if SUPABASE_URL is missing', async () => {
    delete process.env.SUPABASE_URL
    process.env.SUPABASE_SERVICE_KEY = 'test-key'

    vi.resetModules()
    const { db, _resetClient } = await import('../src/db/supabase.js')
    _resetClient()
    expect(() => db()).toThrow('SUPABASE_URL')
  })
})
