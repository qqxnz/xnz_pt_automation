// TTG 免费种子检测测试：抓取 100 条，列出免费的种子名称和过期时间
// 跑法：npx tsx scripts/test-ttg-free.ts
import { listSitesFromDb } from '../backend/src/storage.js'
import { browseTorrents } from '../backend/src/routes/sites/index.js'

async function main() {
  const sites = await listSitesFromDb()
  const ttg = sites.find((s) => s.domain.includes('totheglory'))
  if (!ttg) {
    console.error('未找到 TTG 站点配置')
    process.exit(1)
  }

  console.log(`\n==== TTG (${ttg.domain}) 抓取 100 条种子 ====\n`)

  const start = Date.now()
  const result = await browseTorrents(ttg, '', 1, 100)
  const durationMs = Date.now() - start

  console.log(`抓到 ${result.items.length} 条，耗时 ${durationMs}ms\n`)

  function formatSize(bytes?: number): string {
    if (bytes == null || bytes === 0) return '-'
    const gb = bytes / (1024 ** 3)
    if (gb >= 1) return `${gb.toFixed(2)} GB`
    const mb = bytes / (1024 ** 2)
    return `${mb.toFixed(0)} MB`
  }

  function toShanghai(iso?: string): string {
    if (!iso) return '无'
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  }

  // 按免费状态分类
  const freeItems: Array<{ title: string; subtitle?: string; tags: string[]; freeEndAt?: string; seeders?: number; leechers?: number; size?: number }> = []
  const normalItems: string[] = []

  for (const item of result.items) {
    const marker = `${item.tags.join(' ')} ${item.subtitle ?? ''}`.toLowerCase()
    const isFree = /(free|免费|免費|2x|2 x|two.?x|双倍|雙倍|50\s*%|half.?free|half.?off|半价|半價)/i.test(marker)
    if (isFree) {
      freeItems.push({
        title: item.title,
        subtitle: item.subtitle,
        tags: item.tags,
        freeEndAt: item.freeEndAt,
        seeders: item.seeders,
        leechers: item.leechers,
        size: item.size
      })
    } else {
      normalItems.push(item.title)
    }
  }

  console.log(`==== 免费/优惠种子：${freeItems.length} 条 ====\n`)
  console.log('序号  名称                                                                        做种/下载     大小         过期时间(上海)         Tags')
  console.log('-'.repeat(140))
  for (let i = 0; i < freeItems.length; i++) {
    const f = freeItems[i]
    const name = f.title.slice(0, 55).padEnd(55)
    const sl = `${f.seeders ?? 0}/${f.leechers ?? 0}`.padEnd(10)
    const sz = formatSize(f.size).padEnd(10)
    const endAt = toShanghai(f.freeEndAt).padEnd(22)
    const tags = f.tags.join(', ')
    console.log(`${String(i + 1).padStart(3)}   ${name}  ${sl}  ${sz}  ${endAt}  ${tags}`)
  }

  console.log(`\n==== 非免费种子：${normalItems.length} 条 ====`)
  console.log(`(如需核对具体名称，请查看上方输出)\n`)

  console.log(`\n==== 汇总 ====`)
  console.log(`总计: ${result.items.length} 条`)
  console.log(`免费/优惠: ${freeItems.length} 条`)
  console.log(`非免费: ${normalItems.length} 条`)
  console.log(`耗时: ${durationMs}ms\n`)

  process.exit(0)
}

main().catch((err) => {
  console.error('脚本执行失败：', err)
  process.exit(1)
})
