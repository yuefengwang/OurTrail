#!/usr/bin/env node
/**
 * Stitch 设计资产完整性校验（零依赖）
 *
 *   node tools/design-assets-check.js
 *   node tools/design-assets-check.js --require-tracked
 *   node tools/design-assets-check.js --base=<rev>
 *
 * 校验范围：design-references/stitch/weather/**
 *
 * 判据：
 *  1. manifest.json 可解析，schema 基本字段齐备
 *  2. manifest.files 与磁盘逐文件一致：存在、字节数、SHA-256
 *  3. 快照文件总数 = raw/source 文件 + 登记的文档
 *  4. HTML ↔ PNG 成对；screens[] 与磁盘目录集合互相闭合
 *  5. 所有 screens[].html/png 都出现在 files[]
 *  6. Markdown 本地链接可解析（相对本文件；忽略 http/mailto/锚点）
 *  7. ZIP 与 raw/ 逐文件一致（纯 Node 解 zip，不依赖 unzip）
 *  8. alexandria/DESIGN.md 字节未变
 *  9. 天气生产代码零改动（miniprogram/ + cloudfunctions/）
 * 10. 所有资产已被 Git 跟踪（--require-tracked 时失败，否则只报"待提交"）
 * 11. 文档与 manifest 中无个人目录绝对路径（/Users/、/home/、C:\Users、file://）
 * 12. 无重复内容（同 SHA-256 出现两次）
 * 13. manifest 声明的外部依赖主机 == HTML 里实际出现的主机
 * 14. 本快照不得把任何页面标成 confirmed
 *
 * 不可核验项（例如本机无 git、base 提交不存在）一律打印 WARN 并计入
 * unverified，不伪装成通过。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SNAP_REL = 'design-references/stitch/weather/2026-10-30'
const SNAP = path.join(ROOT, SNAP_REL)
const ENTRY_REL = 'design-references/stitch/weather/README.md'

const argv = process.argv.slice(2)
const REQUIRE_TRACKED = argv.includes('--require-tracked')
const baseArg = argv.find(a => a.startsWith('--base='))
const BASE_COMMIT = baseArg ? baseArg.slice('--base='.length) : 'e5a3d5e'

let passed = 0
let failed = 0
let unverified = 0
const fails = []

function check (name, cond, extra) {
  if (cond) {
    passed++
  } else {
    failed++
    fails.push(name + (extra === undefined ? '' : ' — ' + extra))
    console.log('  ✗ ' + name + (extra === undefined ? '' : ' — ' + extra))
  }
  return !!cond
}

function warn (name, extra) {
  unverified++
  console.log('  … ' + name + (extra === undefined ? '' : ' — ' + extra))
}

let lastSection = null
let lastPassedMark = 0
let lastFailedMark = 0

function flushSection () {
  if (!lastSection) return
  const p = passed - lastPassedMark
  const f = failed - lastFailedMark
  console.log('  § ' + lastSection + '：' + p + ' 项通过' + (f ? '，' + f + ' 项失败' : ''))
}

function section (title) {
  flushSection()
  lastSection = title
  lastPassedMark = passed
  lastFailedMark = failed
  console.log('\n' + title)
}

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function rel (abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

function walk (dir, base) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, base))
    else out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

function git (args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// ---------------------------------------------------------------- 1. manifest

section('1. manifest.json')

let manifest = null
try {
  manifest = JSON.parse(fs.readFileSync(path.join(SNAP, 'manifest.json'), 'utf8'))
  passed++
} catch (e) {
  check('manifest.json 可解析', false, e.message)
}

if (manifest) {
  check('schemaVersion 存在', manifest.schemaVersion === 1, String(manifest.schemaVersion))
  check('pathBase = repository-root', manifest.pathBase === 'repository-root', String(manifest.pathBase))
  check('assetSet.id 存在', !!(manifest.assetSet && manifest.assetSet.id))
  check('assetSet.platform = Google Stitch', manifest.assetSet && manifest.assetSet.platform === 'Google Stitch')
  check('assetSet.importedAt = 2026-10-30', manifest.assetSet && manifest.assetSet.importedAt === '2026-10-30')
  check('stitchProject.id 以未知记录（null）且带说明',
    manifest.assetSet && manifest.assetSet.stitchProject &&
    manifest.assetSet.stitchProject.id === null &&
    manifest.assetSet.stitchProject.idStatus === 'unknown')
  check('screens[] 是数组', Array.isArray(manifest.screens))
  check('files[] 是数组', Array.isArray(manifest.files))
  check('counts.screens = 11', manifest.assetSet && manifest.assetSet.counts && manifest.assetSet.counts.screens === 11)
  check('counts.rawFiles = 23', manifest.assetSet && manifest.assetSet.counts && manifest.assetSet.counts.rawFiles === 23)
  check('source.zipMatchesRaw = true', manifest.assetSet && manifest.assetSet.source && manifest.assetSet.source.zipMatchesRaw === true)
}

// --------------------------------------------- 2. 文件存在 / 字节数 / SHA-256

section('2. manifest.files ↔ 磁盘（存在 / 字节数 / SHA-256）')

const manifestByPath = new Map()
if (manifest && Array.isArray(manifest.files)) {
  for (const f of manifest.files) manifestByPath.set(f.path, f)
}

let hashMismatch = 0
let sizeMismatch = 0
let missing = 0
for (const [p, meta] of manifestByPath) {
  const abs = path.join(ROOT, p)
  if (!fs.existsSync(abs)) {
    missing++
    check('文件存在: ' + p, false)
    continue
  }
  const buf = fs.readFileSync(abs)
  if (buf.length !== meta.bytes) {
    sizeMismatch++
    check('字节数: ' + p, false, 'manifest=' + meta.bytes + ' 实际=' + buf.length)
  }
  if (sha256(buf) !== meta.sha256) {
    hashMismatch++
    check('SHA-256: ' + p, false)
  }
}
check('无缺失文件', missing === 0, missing + ' 个')
check('无字节数不符', sizeMismatch === 0, sizeMismatch + ' 个')
check('无 SHA-256 不符', hashMismatch === 0, hashMismatch + ' 个')
check('manifest.files 共 24 条', manifestByPath.size === 24, String(manifestByPath.size))

// 磁盘上 raw/ + source/ 的文件必须与 manifest.files 完全一致（双向）
const diskAssetFiles = [
  ...walk(path.join(SNAP, 'raw'), SNAP),
  ...walk(path.join(SNAP, 'source'), SNAP)
].sort()
const declaredAssetFiles = Array.from(manifestByPath.keys())
  .map(p => p.replace(SNAP_REL + '/', ''))
  .sort()
check('raw/ + source/ 文件数与 manifest 一致',
  diskAssetFiles.length === declaredAssetFiles.length,
  '磁盘=' + diskAssetFiles.length + ' manifest=' + declaredAssetFiles.length)
check('raw/ + source/ 文件路径逐条一致',
  diskAssetFiles.join('\n') === declaredAssetFiles.join('\n'))

// --------------------------------------------------------- 3. 快照文件总数

section('3. 快照文件总数')

const docPaths = manifest ? Object.values(manifest.documents || {}).filter(p => p.startsWith(SNAP_REL)) : []
const rootFiles = fs.readdirSync(SNAP, { withFileTypes: true })
  .filter(e => e.isFile())
  .map(e => e.name)
  .sort()
const allSnapshotFiles = walk(SNAP, SNAP)
check('文档清单全部存在', docPaths.every(p => fs.existsSync(path.join(ROOT, p))),
  docPaths.filter(p => !fs.existsSync(path.join(ROOT, p))).join(', '))
check('快照根目录 6 个文件（manifest + 5 份文档）', rootFiles.length === 6, rootFiles.join(','))
check('快照内文件总数 = 24 资产 + 6 文档',
  allSnapshotFiles.length === 30,
  '实际=' + allSnapshotFiles.length)

// ------------------------------------------------- 4. HTML ↔ PNG 成对与闭合

section('4. HTML ↔ PNG 成对')

const rawDirs = fs.readdirSync(path.join(SNAP, 'raw'), { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'alexandria')
  .map(e => e.name)
  .sort()
const screenIds = (manifest.screens || []).map(s => s.id).sort()
check('raw/ 下屏目录 11 个', rawDirs.length === 11, String(rawDirs.length))
check('screens[] 与 raw/ 屏目录互相闭合', rawDirs.join(',') === screenIds.join(','),
  '磁盘=' + rawDirs.join(',') + ' manifest=' + screenIds.join(','))

let pairBad = 0
for (const id of rawDirs) {
  const dir = path.join(SNAP, 'raw', id)
  const names = fs.readdirSync(dir).sort()
  if (names.length !== 2 || names[0] !== 'code.html' || names[1] !== 'screen.png') {
    pairBad++
    check('成对且仅有 code.html+screen.png: ' + id, false, names.join(','))
  }
  const s = (manifest.screens || []).find(x => x.id === id)
  if (!s) continue
  if (!manifestByPath.has(s.html) || !manifestByPath.has(s.png)) {
    pairBad++
    check('screens[].html/png 出现在 files[]: ' + id, false)
  }
  if (s.module !== 'weather') check('screens[].module = weather: ' + id, false, String(s.module))
}
check('11 个屏目录全部成对', pairBad === 0, pairBad + ' 个异常')
check('alexandria/DESIGN.md 单独存在',
  fs.existsSync(path.join(SNAP, 'raw/alexandria/DESIGN.md')))

// ------------------------------------------------------- 5. Markdown 本地链接

section('5. Markdown 本地链接')

const mdFiles = walk(path.join(ROOT, 'design-references'), path.join(ROOT, 'design-references'))
  .filter(p => p.endsWith('.md'))
let linksChecked = 0
let linksBroken = 0
for (const relMd of mdFiles) {
  const absMd = path.join(ROOT, 'design-references', relMd)
  const text = fs.readFileSync(absMd, 'utf8')
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(text))) {
    let target = m[1]
    if (/^(https?:|mailto:|tel:|#)/.test(target)) continue
    target = target.split('#')[0]
    if (!target) continue
    linksChecked++
    const resolved = path.resolve(path.dirname(absMd), decodeURI(target))
    if (!fs.existsSync(resolved)) {
      linksBroken++
      check('链接可解析: ' + relMd + ' → ' + target, false)
    }
  }
}
check('Markdown 本地链接全部可解析', linksBroken === 0, linksBroken + '/' + linksChecked + ' 个断链')
check('至少检查了 40 条本地链接', linksChecked >= 40, String(linksChecked))

// ------------------------------------------- 6. ZIP ↔ raw 逐文件一致（纯 Node）

section('6. ZIP ↔ raw 逐文件一致')

function readZip (zipPath) {
  const buf = fs.readFileSync(zipPath)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('找不到 EOCD')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录签名错误 @' + p)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({ name, method, compSize, uncompSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  const files = new Map()
  for (const e of entries) {
    if (e.name.endsWith('/')) continue
    const lh = e.localOffset
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('本地头签名错误: ' + e.name)
    const fnLen = buf.readUInt16LE(lh + 26)
    const exLen = buf.readUInt16LE(lh + 28)
    const start = lh + 30 + fnLen + exLen
    const comp = buf.subarray(start, start + e.compSize)
    let data
    if (e.method === 0) data = Buffer.from(comp)
    else if (e.method === 8) data = zlib.inflateRawSync(comp)
    else throw new Error('不支持的压缩方法 ' + e.method + ': ' + e.name)
    if (data.length !== e.uncompSize) throw new Error('解压长度不符: ' + e.name)
    files.set(e.name, data)
  }
  return { entries, files }
}

let zipOk = false
try {
  const zipPath = path.join(SNAP, 'source/stitch_ourtrail_ui_optimization.zip')
  const zip = readZip(zipPath)
  zipOk = true
  check('ZIP 条目数 36', zip.entries.length === 36, String(zip.entries.length))
  check('ZIP 文件数 23', zip.files.size === 23, String(zip.files.size))
  const ZIP_PREFIX = 'stitch_ourtrail_ui_optimization/'
  const mismatched = []
  let totalBytes = 0
  for (const [name, data] of zip.files) {
    if (!name.startsWith(ZIP_PREFIX)) { mismatched.push(name + '（前缀不符）'); continue }
    const rawRel = name.slice(ZIP_PREFIX.length)
    const abs = path.join(SNAP, 'raw', rawRel)
    totalBytes += data.length
    if (!fs.existsSync(abs)) { mismatched.push(rawRel + '（raw/ 缺失）'); continue }
    const disk = fs.readFileSync(abs)
    if (sha256(disk) !== sha256(data)) mismatched.push(rawRel + '（哈希不符）')
  }
  check('ZIP 内 23 个文件与 raw/ 逐字节一致', mismatched.length === 0, mismatched.join('; '))
  check('ZIP 解压后总字节 = 5,475,222', totalBytes === 5475222, String(totalBytes))
} catch (e) {
  warn('ZIP 校验未完成', e.message)
}

// ----------------------------------------------- 7. DESIGN.md 未改动

section('7. DESIGN.md 未改动')

const designMdRel = SNAP_REL + '/raw/alexandria/DESIGN.md'
const designMeta = manifestByPath.get(designMdRel)
const designBuf = fs.readFileSync(path.join(ROOT, designMdRel))
check('DESIGN.md 1581 字节', designBuf.length === 1581, String(designBuf.length))
check('DESIGN.md SHA-256 与 manifest 一致',
  !!designMeta && sha256(designBuf) === designMeta.sha256)
check('DESIGN.md 未被改写（与导入值相同）',
  sha256(designBuf) === '9c1129c63fb89d3731d391dffcc79531ac03d508547f3ba7e831a9fb90775325')

// ------------------------------------------- 8. 天气生产代码零改动

section('8. 天气生产代码零改动')

try {
  const dirty = git(['diff', '--name-only', 'HEAD', '--', 'miniprogram', 'cloudfunctions']).trim()
  check('工作区 miniprogram/cloudfunctions 无未提交改动', dirty === '', dirty)
  let baseOk = true
  try { git(['rev-parse', '--verify', BASE_COMMIT + '^{commit}']) } catch (e) { baseOk = false }
  if (baseOk) {
    const changed = git(['diff', '--name-only', BASE_COMMIT + '..HEAD', '--', 'miniprogram', 'cloudfunctions']).trim()
    check('自 ' + BASE_COMMIT + ' 起 miniprogram/cloudfunctions 零改动', changed === '', changed)
  } else {
    warn('基线提交不存在，无法证明历史零改动', BASE_COMMIT)
  }
} catch (e) {
  warn('git 不可用，跳过生产代码零改动检查', e.message)
}

// ------------------------------------------------ 9. Git 跟踪

section('9. Git 跟踪')

const trackedTargets = [
  ENTRY_REL,
  ...allSnapshotFiles.map(p => SNAP_REL + '/' + p)
]
let untracked = 0
for (const p of trackedTargets) {
  let isTracked = false
  try {
    git(['ls-files', '--error-unmatch', p])
    isTracked = true
  } catch (e) { isTracked = false }
  if (!isTracked) untracked++
}
if (REQUIRE_TRACKED) {
  check('全部 ' + trackedTargets.length + ' 个文件已被 Git 跟踪', untracked === 0, untracked + ' 个未跟踪')
} else if (untracked > 0) {
  warn('有 ' + untracked + ' 个文件尚未被 Git 跟踪（提交前正常；加 --require-tracked 校验）')
} else {
  check('全部 ' + trackedTargets.length + ' 个文件已被 Git 跟踪', true)
}

// ------------------------------------- 10. 无个人目录绝对路径

section('10. 无个人目录绝对路径')

const scanFiles = [
  ENTRY_REL,
  ...allSnapshotFiles
    .filter(p => /\.(md|json)$/.test(p))
    .map(p => SNAP_REL + '/' + p)
]
const pathPatterns = [/\/Users\//, /\/home\/[^/\s]+/, /[A-Za-z]:\\Users\\/, /file:\/\//]
let badPaths = 0
for (const p of scanFiles) {
  const text = fs.readFileSync(path.join(ROOT, p), 'utf8')
  for (const re of pathPatterns) {
    if (re.test(text)) {
      badPaths++
      check('无个人目录绝对路径: ' + p, false, String(re))
    }
  }
}
check('文档与 manifest 无个人目录绝对路径', badPaths === 0, badPaths + ' 处')

// --------------------------------------------------- 11. 重复内容

section('11. 重复内容')

const byHash = new Map()
for (const [p, meta] of manifestByPath) {
  if (!byHash.has(meta.sha256)) byHash.set(meta.sha256, [])
  byHash.get(meta.sha256).push(p)
}
const dupes = Array.from(byHash.entries()).filter(([, list]) => list.length > 1)
check('无重复内容（同一 SHA-256 只对应一个文件）', dupes.length === 0,
  dupes.map(([h, l]) => l.join(' = ')).join('; '))

// ------------------------------------- 12. 外部依赖声明 ↔ HTML 实际

section('12. 外部依赖声明一致性')

const htmlFiles = (manifest.screens || []).map(s => s.html)
const hostSeen = new Map()
for (const p of htmlFiles) {
  const text = fs.readFileSync(path.join(ROOT, p), 'utf8')
  const re = /https?:\/\/([^/"'\s)>?#]+)/g
  let m
  while ((m = re.exec(text))) {
    const host = m[1].toLowerCase()
    hostSeen.set(host, (hostSeen.get(host) || 0) + 1)
  }
}
const declaredHosts = new Set((manifest.externalDependencies || [])
  .map(d => { try { return new URL(d.url).host.toLowerCase() } catch (e) { return '' } })
  .filter(Boolean))
const IGNORED_HOSTS = new Set(['www.w3.org', 'schema.org'])
const actualHosts = Array.from(hostSeen.keys()).filter(h => !IGNORED_HOSTS.has(h)).sort()
const missingDecl = actualHosts.filter(h => !declaredHosts.has(h))
const missingActual = Array.from(declaredHosts).filter(h => !hostSeen.has(h)).sort()
check('HTML 中每个外部主机都已在 manifest 声明', missingDecl.length === 0, missingDecl.join(', '))
check('manifest 声明的每个主机都真的出现在 HTML 中', missingActual.length === 0, missingActual.join(', '))
check('外部主机数 = 4（tailwind / fonts.googleapis / fonts.gstatic / lh3）',
  actualHosts.length === 4, actualHosts.join(', '))

// ---------------------------------- 13. 本快照不得出现 confirmed

section('13. 状态词约束')

const badStatus = (manifest.screens || []).filter(s => s.status === 'confirmed')
check('本快照没有任何 confirmed 页面', badStatus.length === 0,
  badStatus.map(s => s.id).join(', '))
check('所有页面 status 均为 unresolved',
  (manifest.screens || []).every(s => s.status === 'unresolved'))
check('assetSet.status = snapshot-unratified',
  manifest.assetSet && manifest.assetSet.status === 'snapshot-unratified')
check('designSystem.status = unresolved',
  manifest.assetSet && manifest.assetSet.designSystem &&
  manifest.assetSet.designSystem.status === 'unresolved')

// ---------------------------------------------------------- 汇总

flushSection()
console.log('\n' + '-'.repeat(60))
console.log('design-assets-check: passed=' + passed + ' failed=' + failed +
  (unverified ? ' unverified=' + unverified : '') +
  (zipOk ? '' : ' (zip unverified)'))
if (failed) {
  console.log('\n失败项：')
  for (const f of fails) console.log('  - ' + f)
}
process.exit(failed ? 1 : 0)
