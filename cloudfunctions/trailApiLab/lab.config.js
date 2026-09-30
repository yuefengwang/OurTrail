// trailApiLab 配置 —— 改完需重新上传部署本函数。
// 这是私有测试工具：三种放行方式（满足其一即可调用）：
//   ① 配置白名单 OWNER_OPENIDS（引导/固定，永不失效，不可从面板移除）；
//   ② 动态白名单（推荐日常用）：白名单内的人在「预演面板」粘贴开发者身份码即加白，
//      名单存数据库（ot_meta/lab_allowlist），增删立即生效、无需改本文件重新部署；
//   ③ LAB_SECRET：控制台「云端测试」等无 openid 场景，调用时带 {"secret":"<该值>"}。
'use strict'
module.exports = {
  // 你的身份码（小程序「我的」页复制，形如 o 开头的串）。至少填自己的：
  // 这是首次部署后的引导入口——之后其他开发者都由你在预演面板动态添加。
  // 名单内账号可执行预演阶段/清理/白名单管理，其名下 [预演] 活动会被自动发现。
  OWNER_OPENIDS: ['oyBPoxS5zfOzZ6_8trG2P0vD0zxs'],

  // 可选：无 openid 的调用方式（控制台云端测试）所用的发起人身份码，
  // 用于在不传 activityId 时自动发现 [预演] 活动；也可每次调用时用 ownerOpenid 参数临时指定。
  OWNER_OPENID: 'oyBPoxS5zfOzZ6_8trG2P0vD0zxs',

  // 兜底密钥：未配置时，非白名单调用一律拒绝。请勿写进截图或外传。
  LAB_SECRET: '',
}
