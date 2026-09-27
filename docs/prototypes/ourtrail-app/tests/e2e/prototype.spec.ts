import { expect, test, type Page } from '@playwright/test';

async function user(page: Page, id: string) {
  await page.getByRole('button', { name: '演示工具', exact: true }).click();
  await page.getByLabel('演示账号', { exact: true }).selectOption(id);
  await expect(page.getByRole('dialog', { name: '演示工具' })).not.toBeVisible();
}
async function scene(page: Page, name: string) {
  await page.getByRole('button', { name: '演示工具', exact: true }).click();
  await page.getByLabel('演示场景', { exact: true }).selectOption(name);
  await page.getByRole('button', { name: '重置为所选场景' }).click();
  await page.getByRole('button', { name: '确认重置演示记录' }).click();
  await expect(page.getByRole('dialog', { name: '演示工具' })).not.toBeVisible();
}
async function route(page: Page, path: string) {
  await page.evaluate(path => { window.location.hash = path; }, path);
  await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
}
async function phase(page: Page, activityId: string, label: string) {
  await route(page, `/activities/${activityId}/workspace?tab=overview`);
  await page.getByRole('button', { name: `进入${label}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `确认进入${label}` });
  await dialog.getByLabel('变更原因').fill('浏览器验收，逐项确认现场事实');
  await dialog.getByRole('button', { name: '确认变更，不跳过检查' }).click();
  return dialog;
}
async function fieldPerson(page: Page, activityId: string) {
  await route(page, `/activities/${activityId}/workspace?tab=field`);
  await page.getByRole('button', { name: '现场记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '顾言 · 现场记录' });
  await dialog.getByLabel('逐人核实依据').fill('现场逐人核实，演示记录');
  return dialog;
}
async function snapshot(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ourtrail.prototype.v1')!));
}

test('真实页面完成创建到归档，独立异常阻止假安全', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await scene(page, 'empty'); await user(page, 'u-owner');
  await page.getByRole('button', { name: '发起活动', exact: true }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('溪谷同行 · 浏览器验收');
  await page.getByLabel('出发时间', { exact: true }).fill('2026-09-26T08:00');
  await page.getByLabel('预计结束时间', { exact: true }).fill('2026-09-26T18:00');
  await page.getByLabel('报名截止时间', { exact: true }).fill('2026-09-25T20:00');
  await page.getByRole('button', { name: '02 路线与集合' }).click();
  await page.getByRole('button', { name: '使用明确标注的示例路线' }).click();
  await page.getByRole('button', { name: '添加上车点', exact: true }).click();
  await page.getByLabel('上车点名称', { exact: true }).fill('集合站');
  await page.getByLabel('详细集合位置').fill('演示站口，非真实集合地点');
  await page.getByLabel('集合时间（北京时间）', { exact: true }).fill('2026-09-26T07:00');
  await page.getByRole('button', { name: '03 招募与风险' }).click();
  await page.getByLabel('人数上限', { exact: true }).fill('2');
  await page.getByRole('button', { name: '添加风险提示' }).click();
  await page.getByLabel('风险提示', { exact: true }).fill('湿滑石阶');
  await page.getByLabel('应对建议', { exact: true }).fill('防滑鞋，慢行并现场核实路况');
  await page.getByRole('button', { name: '保存并预览' }).click();
  await expect(page.getByText('未发布预览 · 仅你可见')).toBeVisible();
  const id = new URL(page.url()).hash.split('/')[2].split('?')[0];
  expect((await snapshot(page)).signups).toHaveLength(0);
  await page.getByRole('button', { name: '返回编辑与发布' }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('button', { name: '发布已保存的活动' }).click();
  await page.getByRole('button', { name: '只发布活动，不为本人报名' }).click();
  await expect(page.getByRole('button', { name: '进入工作台' })).toBeVisible();
  await user(page, 'u-new');
  await page.getByRole('button', { name: '填写报名资料' }).click();
  await page.getByLabel('出行方式 / 上车点', { exact: true }).selectOption({ label: '集合站' });
  await page.getByLabel(/同意本次活动使用/).check();
  await page.getByRole('button', { name: '提交报名', exact: true }).click();
  await expect(page.getByText('报名已收到', { exact: true })).toBeVisible();
  await user(page, 'u-owner');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await page.getByRole('button', { name: '名单', exact: true }).click();
  await page.getByLabel('选择顾言', { exact: true }).check();
  await page.getByRole('button', { name: '确认报名', exact: true }).click();
  await page.getByRole('button', { name: '确认仅处理这 1 人' }).click();
  await page.getByRole('button', { name: '分车', exact: true }).click();
  await page.getByRole('button', { name: '添加车辆', exact: true }).click();
  const vehicleForm = page.getByRole('dialog', { name: '添加车辆', exact: true });
  await vehicleForm.getByLabel('车辆名称', { exact: true }).fill('验收1号车');
  await vehicleForm.getByLabel('车牌 / 演示标记').fill('演示-001');
  await vehicleForm.getByRole('button', { name: '添加司机' }).click();
  await vehicleForm.getByLabel('司机姓名', { exact: true }).fill('许川');
  await vehicleForm.getByLabel('司机演示联系电话', { exact: true }).fill('00000000003');
  await vehicleForm.getByLabel('关联演示账号 ID（可选）', { exact: true }).fill('u-driver');
  await vehicleForm.getByLabel('集合站', { exact: true }).check();
  await vehicleForm.getByRole('button', { name: '保存车辆安排' }).click();
  await expect(vehicleForm).not.toBeVisible();
  await page.getByRole('button', { name: '预览自动分车方案' }).click();
  expect((await snapshot(page)).assignments).toHaveLength(0);
  await page.getByRole('button', { name: '明确确认并提交此方案' }).click();
  const vehicleId = (await snapshot(page)).vehicles[0].id;
  await page.getByRole('button', { name: '名单', exact: true }).click();
  await page.getByRole('button', { name: '协作授权', exact: true }).click();
  await page.getByLabel('目标演示账号 ID', { exact: true }).fill('u-driver');
  await page.getByLabel('协作角色', { exact: true }).selectOption('vehicle_contact');
  await page.getByLabel('授权截止时间（北京时间）', { exact: true }).fill('2026-09-27T00:00');
  await page.getByLabel('负责车辆', { exact: true }).selectOption(vehicleId);
  await page.getByRole('button', { name: '保存明确授权' }).click();
  await expect(page.getByText('授权已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭协作授权' }).click();
  await expect(await phase(page, id, '集合签到')).not.toBeVisible();
  let person = await fieldPerson(page, id);
  await person.getByRole('button', { name: '确认现场签到' }).click();
  await expect(person.getByRole('button', { name: '确认现场签到' })).toHaveCount(0);
  await person.getByRole('button', { name: '关闭顾言 · 现场记录' }).click();
  await user(page, 'u-driver'); await route(page, `/activities/${id}/vehicles/${vehicleId}`);
  await page.getByRole('button', { name: '确认上车', exact: true }).click();
  await expect(page.getByText('应到 1 人 · 已上车 1 人')).toBeVisible();
  await page.getByRole('button', { name: '确认本程发车' }).click();
  await user(page, 'u-owner'); person = await fieldPerson(page, id);
  await person.getByRole('button', { name: '核实已随队出发' }).click();
  await person.getByRole('button', { name: '关闭顾言 · 现场记录' }).click();
  await expect(await phase(page, id, '活动进行中')).not.toBeVisible();
  person = await fieldPerson(page, id);
  await person.getByLabel('路线节点', { exact: true }).selectOption({ index: 1 });
  await person.getByRole('button', { name: '确认到达此节点' }).click();
  await person.getByRole('button', { name: '记录下撤报备' }).click();
  await person.getByRole('button', { name: '记录另行返程' }).click();
  await person.getByRole('button', { name: '关闭顾言 · 现场记录' }).click();
  await expect(await phase(page, id, '返程收尾')).not.toBeVisible();
  await user(page, 'u-new'); await route(page, `/activities/${id}`);
  await page.getByRole('button', { name: '确认返程与到家' }).click();
  await page.getByRole('button', { name: '确认已安全到家', exact: true }).click();
  await expect(page.getByText('安全到家已记录。')).toBeVisible();
  await page.getByRole('button', { name: '关闭顾言 · 同行状态' }).click();
  await user(page, 'u-owner');
  const blocked = await phase(page, id, '已归档');
  await expect(blocked.getByRole('alert')).toContainText('异常未核实');
  await blocked.getByRole('button', { name: '关闭确认进入已归档' }).click();
  await route(page, `/activities/${id}/workspace?tab=field`);
  await page.getByLabel(/处理结果/).fill('已电话核实去向和安全到家');
  await page.getByRole('button', { name: '确认本条已解决' }).click();
  await expect(await phase(page, id, '已归档')).not.toBeVisible();
  const final = await snapshot(page);
  expect(final.activities[0].phase).toBe('archived');
  expect(final.signups[0].status).toBe('confirmed');
  expect(final.attendance[0].boardingByLeg.outbound).not.toBeNull();
  expect(final.attendance[0].boardingByLeg.return).toBeNull();
  expect(final.attendance[0].returnPlan.kind).toBe('independent');
  expect(final.attendance[0].home).not.toBeNull();
  expect(final.incidents[0].resolution).not.toBeNull();
  await page.reload();
  expect((await snapshot(page)).activities[0].phase).toBe('archived');
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 430, 1440]) {
  test(`宽度${width}无横向溢出且浮层Back只关闭浮层`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: '青城后山', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`home-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '青城后山', exact: true }).click();
    const before = page.url();
    await page.getByRole('button', { name: '演示工具', exact: true }).click();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: '演示工具' })).not.toBeVisible();
    expect(page.url()).toBe(before);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:5173\/(?:#\/)?$/);
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  });
}

test('离线失败保留输入，恢复后报名并刷新仍保留', async ({ page }) => {
  await page.goto('/'); await user(page, 'u-new'); await route(page, '/activities/a1/signup');
  await page.getByLabel('姓名', { exact: true }).fill('顾言离线演示');
  await page.getByLabel(/同意本次活动使用/).check();
  await page.getByRole('button', { name: '演示工具', exact: true }).click();
  await page.getByLabel('模拟离线，不保存业务修改').check();
  await page.getByRole('button', { name: '关闭演示工具' }).click();
  await page.getByRole('button', { name: '提交报名', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('离线');
  await expect(page.getByLabel('姓名', { exact: true })).toHaveValue('顾言离线演示');
  expect((await snapshot(page)).signups.some((s: { submittedByUserId: string }) => s.submittedByUserId === 'u-new')).toBe(false);
  await page.getByRole('button', { name: '演示工具', exact: true }).click();
  await page.getByLabel('模拟离线，不保存业务修改').uncheck();
  await page.getByRole('button', { name: '关闭演示工具' }).click();
  await page.getByRole('button', { name: '提交报名', exact: true }).click();
  await expect(page.getByText('报名已收到', { exact: true })).toBeVisible();
  await page.reload();
  expect((await snapshot(page)).signups.some((s: { participant: { name: string } }) => s.participant.name === '顾言离线演示')).toBe(true);
});

test('活动中不会提前给出到家按钮，车辆任务从首页直接进入本车', async ({ page }) => {
  await page.goto('/'); await scene(page, 'active');
  await page.getByRole('button', { name: '青城后山', exact: true }).click();
  await page.getByRole('button', { name: '资料与操作', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '林溪 · 同行状态' });
  await expect(dialog.getByRole('button', { name: '确认已安全到家' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭林溪 · 同行状态' }).click();
  await user(page, 'u-driver'); await route(page, '/');
  await page.getByRole('region', { name: '我的协作任务' }).getByRole('button').click();
  await expect(page).toHaveURL(/\/vehicles\/v1$/);
});

test('跳转主内容不改路由，返回恢复手机内容区滚动位置', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '青城后山', exact: true }).click();
  const before = page.url();
  const skip = page.getByRole('link', { name: '跳到主要内容' });
  await skip.focus(); await skip.press('Enter');
  await expect(page).toHaveURL(before);
  await page.locator('.app-main').evaluate(el => { el.scrollTop = 450; });
  await page.getByRole('button', { name: '天气参考' }).click();
  expect(await page.locator('.app-main').evaluate(el => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  expect(await page.locator('.app-main').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
});

test('无效深链不回填默认活动，损坏缓存不自动覆盖', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ourtrail.prototype.v1', '{broken'));
  await page.goto('/#/activities/missing');
  await expect(page.getByText('演示记录暂不可用')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ourtrail.prototype.v1'))).toBe('{broken');
});
