import process from 'node:process'

import PocketBase from 'pocketbase'

const cloud = await authenticated(
  process.env.SOURCE_PB_URL || 'https://7ddi60xr8g6ktz3.ba7w.pocketbasecloud.com',
)
const local = await authenticated(process.env.TARGET_PB_URL || 'http://127.0.0.1:8090')
const collection = 'casting2_materials'
const marker = `replica-${Date.now()}`
let recordId = ''

try {
  const created = await cloud.collection(collection).create({
    name: '__replica_acceptance__',
    code: marker,
    category: 'replication-test',
    is_active: true,
  })
  recordId = created.id
  await waitFor('create', async () => {
    const localRecord = await getOptional(local, collection, recordId)
    return localRecord?.code === marker
  })

  const updatedMarker = `${marker}-updated`
  await cloud.collection(collection).update(recordId, { code: updatedMarker })
  await waitFor('update', async () => {
    const localRecord = await getOptional(local, collection, recordId)
    return localRecord?.code === updatedMarker
  })

  await cloud.collection(collection).delete(recordId)
  await waitFor('delete', async () => !(await getOptional(local, collection, recordId)))
  recordId = ''

  console.log(JSON.stringify({ ok: true, collection, create: true, update: true, delete: true }))
} finally {
  if (recordId) {
    await cloud.collection(collection).delete(recordId).catch(() => undefined)
    await local.collection(collection).delete(recordId).catch(() => undefined)
  }
}

async function authenticated(baseURL) {
  const pb = new PocketBase(baseURL)
  pb.autoCancellation(false)
  await pb
    .collection('_superusers')
    .authWithPassword(required('PB_ADMIN_EMAIL'), required('PB_ADMIN_PASSWORD'))
  return pb
}

async function getOptional(pb, collectionName, id) {
  try {
    return await pb.collection(collectionName).getOne(id, { requestKey: null })
  } catch (error) {
    if (error?.status === 404) return null
    throw error
  }
}

async function waitFor(action, predicate) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`Timed out waiting for replica ${action}`)
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
