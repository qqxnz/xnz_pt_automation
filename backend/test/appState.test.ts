import { test } from 'node:test'
import { strict as assert } from 'node:assert'

import {
  getAppState,
  migrationPercent,
  resetForTest,
  setDbVersion,
  setSchemaVersion,
  setStatus,
  subscribe,
  updateHealth,
  updateMigration
} from '../src/appState.js'

test('appState starts in STARTING status with zeroed version', () => {
  resetForTest()
  const s = getAppState()
  assert.equal(s.status, 'STARTING')
  assert.equal(s.schemaVersion, 0)
  assert.equal(s.dbVersion, 0)
  assert.equal(s.migration, undefined)
})

test('appState transitions STARTING → MIGRATING → READY', () => {
  resetForTest()
  setSchemaVersion(21)
  setDbVersion(15)
  setStatus('MIGRATING', {})
  assert.equal(getAppState().status, 'MIGRATING')
  updateMigration({ from: 15, to: 21, currentStep: 2, totalSteps: 6, currentTable: 'tasks' })
  assert.equal(migrationPercent(getAppState()), 33)
  setStatus('READY', {})
  assert.equal(getAppState().status, 'READY')
})

test('appState notifies subscribers on each transition', () => {
  resetForTest()
  const events: string[] = []
  const unsub = subscribe((s) => events.push(s.status))
  setStatus('MIGRATING', {})
  setStatus('READY', {})
  unsub()
  setStatus('MIGRATION_FAILED', {})
  assert.deepEqual(events, ['MIGRATING', 'READY'])
})

test('appState migrationPercent is correct at boundaries', () => {
  resetForTest()
  setSchemaVersion(21)
  setDbVersion(15)
  updateMigration({ from: 15, to: 21, currentStep: 0, totalSteps: 6 })
  assert.equal(migrationPercent(getAppState()), 0)
  updateMigration({ currentStep: 6 })
  assert.equal(migrationPercent(getAppState()), 100)
  updateMigration({ currentStep: 12 })
  assert.ok(migrationPercent(getAppState()) <= 100)
})

test('appState handles DOWNGRADE_REJECTED status', () => {
  resetForTest()
  setSchemaVersion(20)
  setDbVersion(22)
  setStatus('DOWNGRADE_REJECTED', {})
  assert.equal(getAppState().status, 'DOWNGRADE_REJECTED')
})

test('appState stores health report', () => {
  resetForTest()
  updateHealth({ tablesChecked: 12, repairedColumns: 1, repairedTables: 0, removedNewTables: 0, issues: [] })
  const s = getAppState()
  assert.equal(s.health?.tablesChecked, 12)
  assert.equal(s.health?.repairedColumns, 1)
})
