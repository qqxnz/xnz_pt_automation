import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPasswordHash } from './utils/password.js'

export type UserRecord = {
  id: string
  username: string
  passwordHash: string
  passwordChangedAt?: string
  lastLoginAt?: string
}

type AppState = {
  users: UserRecord[]
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data')
const stateFile = path.join(dataDir, 'app-state.json')

async function initialState(): Promise<AppState> {
  return {
    users: [
      {
        id: 'admin',
        username: 'admin',
        passwordHash: await createPasswordHash(process.env.DEFAULT_ADMIN_PASSWORD ?? '123456')
      }
    ]
  }
}

export async function readState(): Promise<AppState> {
  try {
    const raw = await readFile(stateFile, 'utf8')
    return JSON.parse(raw) as AppState
  } catch (error) {
    const state = await initialState()
    await writeState(state)
    return state
  }
}

export async function writeState(state: AppState) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8')
}
