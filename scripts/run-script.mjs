// Runs a TypeScript script against the real storage/ folder, with the "@/..." alias resolved by jiti.
//   node scripts/run-script.mjs scripts/seed-offboarding-demo.ts
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/run-script.mjs <script.ts>')
  process.exit(1)
}
process.chdir(ROOT)
const jiti = createJiti(pathToFileURL(path.join(ROOT, 'scripts', 'run-script.mjs')).href, { alias: { '@': ROOT } })
// A script either does its work on import, or default-exports a function to run.
const mod = await jiti.import(path.resolve(ROOT, target))
const main = mod?.default ?? mod
if (typeof main === 'function') await main()
