import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  }),
}))

describe('deleteTransaction', () => {
  it('deletes by id without throwing', async () => {
    const { deleteTransaction } = await import('../../src/tools/delete-transaction.js')
    await expect(deleteTransaction('uuid-1')).resolves.not.toThrow()
  })
})
