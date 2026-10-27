// 删掉误入库的提交信息草稿
const fs = require('fs')
fs.unlinkSync('D:/OurTrail-ui/docs/ui-ux-redesign/.git-commit-msg.txt')
console.log('removed commit-msg draft')