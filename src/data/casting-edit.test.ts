import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pb } from './pocketbase'
import { updateCastingSession, updateCastingSessionHeader } from './casting'

vi.mock('@/data/pocketbase', () => ({ pb: { collection: vi.fn(), createBatch: vi.fn() } }))

const getOne = vi.fn().mockResolvedValue({ cost_formula_version: 2, coal_rate: 11, worker_salary: 200, chol_in: 6 })
const updateHeader = vi.fn().mockResolvedValue({})
const create = vi.fn()
const update = vi.fn()
const send = vi.fn().mockResolvedValue([{ status: 200 }])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pb.collection).mockImplementation((collection) => ({
    getOne, update: updateHeader,
    getList: vi.fn().mockResolvedValue({ totalPages: 1, items: collection === 'casting_materials' ? [{ id: 'brass-master', name: 'Brass' }] : [] }),
  }) as unknown as ReturnType<typeof pb.collection>)
  vi.mocked(pb.createBatch).mockReturnValue({
    collection: (collection: string) => ({
      create: (record: unknown) => create(collection, record),
      update: (id: string, record: unknown) => update(collection, id, record),
    }),
    send,
  } as unknown as ReturnType<typeof pb.createBatch>)
})

describe('casting log edits', () => {
  it('updates remarks and date without writing batches or material records', async () => {
    await updateCastingSessionHeader('session', { date: '2026-11-24', note: 'Updated remarks' })
    expect(updateHeader).toHaveBeenCalledExactlyOnceWith('session', { date: '2026-11-24', note: 'Updated remarks' })
    expect(pb.createBatch).not.toHaveBeenCalled()
  })

  it('retains batch numbers, individual rates, and material IDs in a full update', async () => {
    await updateCastingSession('session', {
      date: '2026-11-24', note: 'Two batches', coalKg: 18, coalRate: 12, workerSalary: 300,
      batches: [1, 3].map((batchNumber) => ({
        batchNumber, wireOut: 9, mel: 1,
        inputs: [{ materialId: 'brass-master', materialName: 'Brass', qty: 10, rate: 700 + batchNumber }],
      })),
    })
    const batches = create.mock.calls.filter(([collection]) => collection === 'casting_batches').map(([, body]) => body)
    expect(batches.map((batch) => batch.batch_number)).toEqual([1, 3])
    expect(create).toHaveBeenCalledWith('casting_batch_inputs', expect.objectContaining({ batch: batches[0].id, material: 'brass-master', rate: 701 }))
    expect(create).toHaveBeenCalledWith('casting_batch_inputs', expect.objectContaining({ batch: batches[1].id, material: 'brass-master', rate: 703 }))
    expect(update).toHaveBeenCalledWith('casting_sessions', 'session', expect.objectContaining({ unit: 2, chol_in: 6, coal_kg: 18, coal_rate: 12, worker_salary: 300 }))
    expect(send).toHaveBeenCalledTimes(1)
  })
})
