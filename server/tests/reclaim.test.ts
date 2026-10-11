// 预览端口回收：工具重启后遗留的孤儿进程会占着 9400 起的端口，导致下一次预览起不来。
// 这里只测解析与判断这两块纯逻辑，真正的杀进程走 reclaimPreviewPorts。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseNetstatListeners,
  parsePidList,
  pickOrphanProcesses,
  previewPortRange,
  shouldReclaim,
} from '../src/runtime/reclaim.js'

const NETSTAT_FIXTURE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    127.0.0.1:9320         0.0.0.0:0              LISTENING       62684',
  '  TCP    127.0.0.1:9400         0.0.0.0:0              LISTENING       41808',
  '  TCP    127.0.0.1:9401         0.0.0.0:0              LISTENING       58708',
  '  TCP    127.0.0.1:5180         0.0.0.0:0              LISTENING       12345',
  '  TCP    127.0.0.1:9400         127.0.0.1:52344        ESTABLISHED     41808',
  '  TCP    [::]:9402              [::]:0                 LISTENING       99999',
  '  UDP    127.0.0.1:9403         *:*                                    11111',
  '',
].join('\n')

test('只挑出目标端口上的 LISTENING 监听者，忽略 ESTABLISHED/UDP/区间外端口', () => {
  const hits = parseNetstatListeners(NETSTAT_FIXTURE, [9400, 9401])
  assert.deepEqual(hits, [
    { port: 9400, pid: 41808 },
    { port: 9401, pid: 58708 },
  ])
})

test('区间里的其它端口也能被扫到（用于启动时整段回收）', () => {
  const range = previewPortRange(9400, 2)
  assert.deepEqual(range, [9400, 9401, 9402, 9403])
  const hits = parseNetstatListeners(NETSTAT_FIXTURE, range)
  assert.deepEqual(
    hits.map((item) => item.port),
    [9400, 9401, 9402],
  )
})

test('只有 node/npm 系的进程允许被回收，别的一律不动', () => {
  assert.equal(shouldReclaim('node.exe'), true)
  assert.equal(shouldReclaim('node'), true)
  assert.equal(shouldReclaim('NPM.EXE'), true)
  assert.equal(shouldReclaim('chrome.exe'), false)
  assert.equal(shouldReclaim('postgres.exe'), false)
  assert.equal(shouldReclaim(''), false)
})

test('POSIX 的 lsof 输出解析：只留正整数 PID', () => {
  assert.deepEqual(parsePidList('41808\n58708\n'), [41808, 58708])
  assert.deepEqual(parsePidList('\n  1234 \n不是数字\n0\n'), [1234])
  assert.deepEqual(parsePidList(''), [])
})
test('残留进程识别：只挑跑在工具工作区里的 node/cmd，别的一律不动', () => {
  const workspaces = 'D:\\miniwechat\\var\\workspaces'
  const entries = [
    // 上一轮预览留下的 tsx 监督进程：没在监听端口，端口扫描看不到它 .
    { pid: 11, name: 'node.exe', commandLine: 'node D:\\miniwechat\\var\\workspaces\\prj_a\\node_modules\\tsx\\dist\\cli.mjs watch src/index.ts' },
    // 命令行里带完整子命令的 cmd 包装进程 .
    { pid: 12, name: 'cmd.exe', commandLine: 'cmd.exe /d /s /c node D:\\miniwechat\\var\\workspaces\\prj_a\\node_modules\\vite\\bin\\vite.js' },
    // npm 包装进程只有 npm run dev:h5，命令行里没有工作区路径；子进程被清掉后它会自己退出 .
    { pid: 13, name: 'cmd.exe', commandLine: 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c npm run dev:h5' },
    // 工具本体跑在 server/ 下，不在 workspaces 里 .
    { pid: 14, name: 'node.exe', commandLine: 'node --import tsx D:\\miniwechat\\server\\src\\index.ts' },
    // 控制台 dev server 在 web/ 下 .
    { pid: 15, name: 'node.exe', commandLine: 'node D:\\miniwechat\\web\\node_modules\\vite\\bin\\vite.js' },
    // 进程名不在白名单里，哪怕命令行命中也不动 .
    { pid: 16, name: 'chrome.exe', commandLine: 'chrome --open D:\\miniwechat\\var\\workspaces\\prj_a' },
    // 没有命令行 .
    { pid: 17, name: 'node.exe', commandLine: '' },
  ]
  const expected = [
    { pid: 11, name: 'node.exe' },
    { pid: 12, name: 'cmd.exe' },
  ]
  assert.deepEqual(pickOrphanProcesses(entries, workspaces), expected)
  // 结尾斜杠 / 正反斜杠写法都要认得出来 .
  assert.deepEqual(pickOrphanProcesses(entries, workspaces + "/"), expected)
})
