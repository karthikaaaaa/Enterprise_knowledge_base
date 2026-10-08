// Test runner: Node's built-in node:test, with TypeScript + the "@/..." path alias handled by jiti
// (already in node_modules). Every run gets a throwaway working directory, because
// lib/workflow-store.ts keeps its database at <cwd>/storage/workflows.db — tests never touch the
// real storage/ folder.
//
//   npm test                      run every tests/**/*.test.ts
//   npm test -- tests/foo.test.ts run specific files
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function findTests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return findTests(full)
    return entry.name.endsWith('.test.ts') ? [full] : []
  })
}

const requested = process.argv.slice(2).map((file) => path.resolve(ROOT, file))
const files = requested.length > 0 ? requested : findTests(path.join(ROOT, 'tests'))

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ekb-tests-'))
process.chdir(sandbox)
// Tests inject their own model stubs; make sure nothing can reach a real model by accident.
process.env.GEMINI_API_KEY = ''

const jiti = createJiti(pathToFileURL(path.join(ROOT, 'scripts', 'run-tests.mjs')).href, { alias: { '@': ROOT } })
for (const file of files) {
  await jiti.import(file)
}

process.on('exit', () => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true })
  } catch {
    // The sqlite handle may still be open on Windows — the OS temp cleaner will get it.
  }
})
