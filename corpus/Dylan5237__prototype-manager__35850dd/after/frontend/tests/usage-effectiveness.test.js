import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const page = fs.readFileSync(path.join(root, 'src/views/AdminUsageEffectiveness.vue'), 'utf8')
const layout = fs.readFileSync(path.join(root, 'src/components/AdminLayout.vue'), 'utf8')
const router = fs.readFileSync(path.join(root, 'src/router/index.js'), 'utf8')
const api = fs.readFileSync(path.join(root, 'src/api/admin-usage.js'), 'utf8')
const template = page.split('<script setup>')[0]

test('usage effectiveness page is a separate admin destination backed by its dedicated API', () => {
  assert.match(layout, /使用总览/)
  assert.match(layout, /使用与成效分析/)
  assert.match(router, /\/admin\/usage-effectiveness/)
  assert.match(api, /\/admin\/usage-effectiveness/)
})

test('page preserves frozen IA, trusted metrics and explicit unsupported-metric empty states', () => {
  for (const text of ['结论摘要', '核心指标', '有效业务任务趋势', '用户覆盖', '业务使用', '质量与效率', '最近业务任务', '数据口径说明']) {
    assert.match(page, new RegExp(text))
  }
  for (const text of ['待配置用户范围', '暂无复核样本', '暂无效率对比样本', '当前日志无法可靠推出']) {
    assert.match(page, new RegExp(text))
  }
  assert.match(page, /is_test=1/)
  assert.match(page, /exclusion_reason/)
  assert.doesNotMatch(page, /92分|4分|mock/i)
})

test('repeat-rate UI keeps denominator-zero as an empty value instead of a fake zero', () => {
  assert.match(page, /repeatUserRate == null \? '—'/)
  assert.match(page, /暂无有效用户分母/)
})

test('reporting dates, evidence fields and trend fallback preserve the frozen review contract', () => {
  assert.match(page, /Asia\/Shanghai/)
  assert.match(page, /timeZone: 'Asia\/Shanghai'/)
  assert.match(page, /reportingBoundaryIso/)
  for (const field of ['startedAt', 'completedAt', 'prototypeId', 'projectId']) assert.match(page, new RegExp(field))
  for (const series of ['total', 'create', 'direct', 'project']) assert.match(page, new RegExp(`point\\.${series}`))
  assert.doesNotMatch(page, /color:#94a3b8|fill:#94a3b8/)
})

test('visual return keeps trust copy secondary and makes empty sections compact', () => {
  assert.match(template, /class="trust-copy"/)
  assert.doesNotMatch(template, /class="trust-note"/)
  assert.match(template, /'is-empty': !data\.trend\.length/)
  assert.match(template, /'is-empty': !data\.recentTasks\.length/)
  assert.match(page, /\.group-card\{min-height:0\}/)
  assert.match(page, /\.trend-panel\.is-empty/)
  assert.match(page, /报告导出将在数据口径稳定后开放/)
})

test('main page uses product language while technical terms remain in methodology and evidence details', () => {
  for (const text of ['仅统计已完成且符合口径的真实业务任务', '按实际使用用户去重']) {
    assert.match(page, new RegExp(text))
  }
  for (const text of ['按完成日期与任务类型统计', '次尝试', '重试不会重复计为业务任务', '使用用户', '任务 ID', '尝试次数', '质量与效率指标', '待积累数据']) {
    assert.match(template, new RegExp(text))
  }
  for (const text of ['已具备', '明确空态', '证据尚未完备']) assert.doesNotMatch(template, new RegExp(text))
})
