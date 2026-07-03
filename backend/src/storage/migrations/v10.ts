import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

const SITE_NAME_MAP: Record<string, string> = {
  'm-team.cc': '馒头',
  'pt.m-team.cc': '馒头',
  'api.m-team.cc': '馒头',
  'hhanclub.net': '憨憨',
  'www.hhanclub.net': '憨憨',
  'hdhome.org': '家园',
  'www.hdhome.org': '家园',
  'hdkyl.in': '麒麟',
  'www.hdkyl.in': '麒麟',
  'totheglory.im': '听听歌',
  'www.totheglory.im': '听听歌',
  'pt.keepfrds.com': '朋友',
  'keepfrds.com': '朋友',
  'ptchdbits.co': '彩虹岛',
  'www.ptchdbits.co': '彩虹岛',
  'pterclub.net': '猫站',
  'pterclub.com': '猫站',
  'www.pterclub.com': '猫站',
  'ourbits.club': '我堡',
  'www.ourbits.club': '我堡',
  'pthome.net': '铂金家',
  'www.pthome.net': '铂金家',
  'ubits.club': '优堡',
  'www.ubits.club': '优堡',
  'pttime.org': '时间',
  'www.pttime.org': '时间'
}

function buildCaseSql(): { sql: string; params: string[] } {
  const keys = Object.keys(SITE_NAME_MAP)
  const whens = keys.map(() => 'WHEN ? THEN ?').join(' ')
  const params: string[] = []
  for (const k of keys) {
    params.push(k, SITE_NAME_MAP[k])
  }
  params.push('domain')
  return {
    sql: `UPDATE sites SET name = CASE lower(domain) ${whens} ELSE ? END WHERE trim(name) = ''`,
    params
  }
}

export const v10: Migration = {
  version: 10,
  description: '站点显示名映射 + 自动按域名填 name',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'sites', 'name', "TEXT NOT NULL DEFAULT ''")
    const { sql, params } = buildCaseSql()
    db.prepare(sql).run(...params)
  }
}
