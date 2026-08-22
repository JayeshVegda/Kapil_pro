import fs from 'node:fs'
import process from 'node:process'

import { isReplicaStatusHealthy } from './lib/pb-replication.mjs'

const stateFile = process.env.REPLICA_STATE_FILE || '/state/status.json'
const maxAgeMs = Number(process.env.REPLICA_HEALTH_MAX_AGE_SECONDS || 120) * 1_000

try {
  const status = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  if (!isReplicaStatusHealthy(status, Date.now(), maxAgeMs)) process.exit(1)
} catch {
  process.exit(1)
}
