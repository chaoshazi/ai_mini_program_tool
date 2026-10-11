// .claude/skills 校验：frontmatter 合法、description 有触发与不适用边界、正文含三节、行数上限。
// 用法：node scripts/check-skills.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = path.join(root, '.claude', 'skills')
const MAX_LINES = 60
const SECTIONS = ['结构', '不变量', '验证']
/** 必备技能：缺了直接失败（其余技能按需保留）。 */
const REQUIRED = ['dev', 'generator', 'templates', 'api', 'qa-workflow']

if (!fs.existsSync(skillsDir)) {
  console.error('找不到目录：' + skillsDir)
  process.exit(1)
}

const problems = []
const summary = []

function fail(skill, message) {
  problems.push(skill + '：' + message)
}

for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const name = entry.name
  const file = path.join(skillsDir, name, 'SKILL.md')
  if (!fs.existsSync(file)) {
    fail(name, '缺少 SKILL.md')
    continue
  }
  const raw = fs.readFileSync(file)
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fail(name, '文件带 BOM，应为 UTF-8 无 BOM')
  const text = raw.toString('utf8')
  if (text.includes('\r\n')) fail(name, '存在 CRLF，应统一 LF')

  const lines = text.split('\n')
  if (lines.length > MAX_LINES) fail(name, '正文 ' + lines.length + ' 行，超过 ' + MAX_LINES + ' 行上限')

  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!frontmatter) {
    fail(name, '缺少 YAML frontmatter')
    continue
  }
  const body = text.slice(frontmatter[0].length)
  const fields = {}
  for (const line of frontmatter[1].split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (match) fields[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }

  if (fields.name !== name) fail(name, 'frontmatter 的 name 必须是目录名（当前：' + (fields.name ?? '缺失') + '）')
  const description = fields.description ?? ''
  if (description.length < 40) fail(name, 'description 太短，写不清什么时候用')
  if (!/不适用/.test(description)) fail(name, 'description 必须写清「不适用于什么」')
  if (description.length > 400) fail(name, 'description 过长（' + description.length + ' 字），会稀释触发判断')

  for (const section of SECTIONS) {
    if (!new RegExp('^##\\s*' + section, 'm').test(body)) fail(name, '正文缺少「' + section + '」小节')
  }
  if (!/```/.test(body)) fail(name, '正文里没有可执行命令（代码块）')

  summary.push(name.padEnd(16) + lines.length + ' 行')
}

for (const name of REQUIRED) {
  if (!fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))) fail(name, '缺少必备技能目录')
}

console.log('技能清单：\n  ' + summary.join('\n  '))
if (problems.length > 0) {
  console.error('\n✗ 技能校验失败：')
  for (const problem of problems) console.error('  - ' + problem)
  process.exit(1)
}
console.log('\n✓ 技能校验通过（' + summary.length + ' 个技能）')