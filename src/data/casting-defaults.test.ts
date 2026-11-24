import { describe, expect, it, vi } from 'vitest'
import { pb } from '@/data/pocketbase'
import { loadLatestCastingDefaults } from './casting'

vi.mock('@/data/pocketbase', () => ({ pb: { collection: vi.fn() } }))

describe('latest casting defaults', () => {
  it('uses one session and the last batch rate for each material on schemas without created', async () => {
    const reads = {
      casting_sessions: vi.fn().mockResolvedValue({
        items: [{ id: 'latest', coal_kg: 23, coal_rate: 12.5, worker_salary: 800 }],
      }),
      casting_batches: vi.fn().mockResolvedValue({ totalPages: 1, items: [{ id: 'first' }, { id: 'last' }] }),
      casting_batch_inputs: vi.fn().mockResolvedValue({
        totalPages: 1,
        items: [
          { batch: 'last', material_name: ' Brass ', rate: 815 },
          { batch: 'first', material_name: 'brass', rate: 805 },
          { batch: 'first', material_name: 'Aux  Chol', rate: 630 },
        ],
      }),
    }
    vi.mocked(pb.collection).mockImplementation((name) => ({ getList: reads[name as keyof typeof reads] }) as unknown as ReturnType<typeof pb.collection>)
    expect(await loadLatestCastingDefaults()).toEqual({
      coalKg: 23, coalRate: 12.5, workerSalary: 800, materialRates: { brass: 815, 'aux chol': 630 },
    })
    expect(reads.casting_sessions).toHaveBeenCalledExactlyOnceWith(1, 1, { sort: '-date,-id' })
    expect(reads.casting_batches).toHaveBeenCalledWith(1, 200, { filter: 'session = "latest"', sort: 'batch_number,id' })
  })

  it('returns empty defaults when no sessions have been saved', async () => {
    const getList = vi.fn().mockResolvedValue({ items: [] })
    vi.mocked(pb.collection).mockReturnValue({ getList } as unknown as ReturnType<typeof pb.collection>)
    expect(await loadLatestCastingDefaults()).toEqual({ coalKg: 0, coalRate: 0, workerSalary: 0, materialRates: {} })
    expect(getList).toHaveBeenCalledTimes(1)
  })
})
