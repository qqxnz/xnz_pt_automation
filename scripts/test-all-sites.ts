// 全站抓取测试脚本：遍历所有站点，调用 browseTorrents(site, '', 1, 100) 看看实际能抓到多少条
// 跑法：npx tsx scripts/test-all-sites.ts [pageSize]
import { listSitesFromDb } from '../backend/src/storage.js'
import { browseTorrents, siteDisplayName } from '../backend/src/routes/sites/index.js'

const pageSize = Number(process.argv[2] ?? 100)

async function main() {
  const sites = await listSitesFromDb()
  console.log(`\n==== 全站抓取测试 pageSize=${pageSize}（共 ${sites.length} 个站点） ====\n`)

  const results: Array<{ name: string; status: string; count: number; error?: string; durationMs: number; pages?: number }> = []

  for (const site of sites) {
    const name = siteDisplayName(site)
    const start = Date.now()
    process.stdout.write(`⏳ ${name.padEnd(8)} (${site.domain}) ... `)
    try {
      const result = await browseTorrents(site, '', 1, pageSize)
      const durationMs = Date.now() - start
      results.push({ name, status: 'OK', count: result.items.length, durationMs })
      console.log(`OK  抓到 ${result.items.length}/${pageSize} 条  (${durationMs}ms)`)
    } catch (error) {
      const durationMs = Date.now() - start
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ name, status: 'FAIL', count: 0, error: msg, durationMs })
      console.log(`FAIL  ${msg}  (${durationMs}ms)`)
    }
  }

  console.log('\n==== 汇总 ====\n')
  console.log('站点         域名                       状态    抓到/请求   耗时')
  console.log('-'.repeat(76))
  for (const r of results) {
    const status = r.status === 'OK' ? '✅ OK  ' : '❌ FAIL'
    const countStr = r.status === 'OK' ? `${String(r.count).padStart(3)}/${pageSize}` : '-       '
    console.log(`${r.name.padEnd(8)}   ${'-'.padEnd(24)}   ${status}   ${countStr}     ${r.durationMs}ms${r.error ? '  ' + r.error : ''}`)
  }

  const ok = results.filter((r) => r.status === 'OK').length
  const fullCount = results.filter((r) => r.status === 'OK' && r.count >= pageSize).length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log(`\n==== 结果：${ok} 个成功（${fullCount} 个能拿到 ${pageSize} 条），${fail} 个失败 ====\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('脚本执行失败：', err)
  process.exit(1)
})
