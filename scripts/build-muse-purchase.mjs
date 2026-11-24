import path from 'node:path'
import { rolldown } from 'rolldown'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await rolldown({
  input: path.join(root, 'scripts/muse-purchase-api.ts'),
  platform: 'node',
  resolve: { alias: { '@': path.join(root, 'src') } },
  external: ['zod'],
})
try {
  await bundle.write({ file: path.join(root, 'runtime/state/muse-purchase-api.mjs'), format: 'esm' })
} finally {
  await bundle.close()
}
