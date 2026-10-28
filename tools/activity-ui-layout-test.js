'use strict'
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../miniprogram')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
let passed = 0
let failed = 0
function check(name, condition) {
  if (condition) { passed++; console.log('PASS ' + name) }
  else { failed++; console.error('FAIL ' + name) }
}
const activityPages = ['home', 'discover', 'activity', 'editor', 'signup', 'workspace', 'tasks', 'vehicle', 'staff', 'anotices']
const panels = ['roster-panel', 'transport-panel', 'field-panel']
for (const page of activityPages) {
  const template = read('pages/' + page + '/' + page + '.wxml').replace(/<!--[\s\S]*?-->/g, '').replace(/<wxs[^>]*\/>/g, '').trim()
  check(page + ' root opts into the activity design system', /^<view class="page activity-ui(?:\s|\")/.test(template))
}
for (const page of ['weather', 'weather-hub', 'weather-plan', 'weather-chart', 'routes', 'route', 'me', 'notices']) {
  check(page + ' does not inherit activity-specific overrides', !/activity-ui/.test(read('pages/' + page + '/' + page + '.wxml')))
}
for (const panel of panels) {
  check(panel + ' uses shared styles and activity scope', /styleIsolation:\s*'apply-shared'/.test(read('components/' + panel + '/' + panel + '.js')) && /^<view class="stack activity-ui activity-panel">/.test(read('components/' + panel + '/' + panel + '.wxml')))
}
const app = read('app.wxss').replace(/\/\*[\s\S]*?\*\//g, '')
const scopedRules = [...app.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => /activity-ui|activity-panel/.test(match[1]))
check('shared activity styling has no raw colors or new tokens', scopedRules.length > 10 && scopedRules.every(match => !/#[\da-f]{3,8}\b|rgba?\(|--[\w-]+\s*:/.test(match[2])))
check('shared activity helpers have one global source', activityPages.every(page => !/\.activity-intro\s*\{|\.activity-nav-icon\s*\{/.test(read('pages/' + page + '/' + page + '.wxss'))))
const editor = read('pages/editor/editor.wxml')
check('draft save is secondary and remains busy guarded', /class="button secondary \{\{busy \|\| contentBusy \? 'disabled' : ''\}\}"[^>]+bindtap="\{\{busy \|\| contentBusy \? '' : 'onSave'\}\}"/.test(editor))
const signup = read('pages/signup/signup.wxml')
check('signup header identifies the real activity and footer counts real participants', /signup-activity-title">\{\{activityTitle\}\}/.test(signup) && /已选 \{\{participants.length\}\} 人/.test(signup))
check('participant selection still binds dataset to the group', /<checkbox-group[^>]+data-key="\{\{item.key\}\}"[^>]+bindchange="onToggleCandidate"/.test(signup))
const workspace = read('pages/workspace/workspace.wxml')
check('panel tabs retain state and sibling write invalidation', panels.every(panel => {
  const tag = workspace.match(new RegExp('<' + panel + '\\b[^>]*>'))
  return tag && !/wx:if/.test(tag[0]) && /sync-key="\{\{syncKey\}\}"/.test(tag[0]) && /bind:written="onPanelSync"/.test(tag[0])
}))
check('workspace summary keeps cross-panel navigation in compact mode', /workspace-band--compact/.test(workspace) && ['goRoster', 'goTransport', 'goField'].every(handler => workspace.includes('bindtap="' + handler + '"')))
console.log('passed=' + passed + ' failed=' + failed + ' (source contracts only; native evidence is separate)')
process.exitCode = failed ? 1 : 0
