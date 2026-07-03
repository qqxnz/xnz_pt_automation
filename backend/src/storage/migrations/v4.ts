import type { Migration } from './index.js'
import type { DatabaseSync } from 'node:sqlite'
import { addColumnIfMissing } from './_helpers.js'

export const v4: Migration = {
  version: 4,
  description: '种子 + 下载器：IPv6 peer 字段',
  up: (db: DatabaseSync) => {
    addColumnIfMissing(db, 'torrents', 'has_ipv6_peers', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'ipv6_peer_count', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'total_peer_count', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'peer_sync_rid', 'INTEGER')
    addColumnIfMissing(db, 'torrents', 'peer_synced_at', 'TEXT')
    addColumnIfMissing(db, 'downloaders', 'has_ipv6_peers', 'INTEGER')
    addColumnIfMissing(db, 'downloaders', 'ipv6_torrent_count', 'INTEGER')
    addColumnIfMissing(db, 'downloaders', 'ipv6_synced_at', 'TEXT')
  }
}
