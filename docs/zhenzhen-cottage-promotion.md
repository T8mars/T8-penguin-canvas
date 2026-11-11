# 顶部贞贞小屋入口

2026-11-08：仅T8画布开发，已获v3.5.1发布授权，进度见[发布专题](release-v3.5.1.md)。

- 顶部“贞贞工坊”左侧新增“贞贞小屋”胶囊入口；展开显示“贞贞的平价AI小屋”及用户指定文案：“贞贞的新网站，所有模型价格比老网站低35%-100%，推荐使用，支持在线画布等特色功能”。价格描述为用户提供的推广文案，本轮没有独立价格审计。
- 跳转按钮打开`https://api.seedance.nz/?s=ibVH`，保留大小写和参数，使用新窗口与`noopener noreferrer`。原工坊/API获取入口、渠道、账号和保存配置均未改。
- 组件为`src/components/ZhenzhenCottagePromotion.tsx`，由`src/App.tsx`接入；双语在`src/i18n/resources.ts`。浮层通过Portal避免顶栏裁剪，限制视口边界和最大高度，支持按钮切换、关闭按钮、外部点击、Escape及键盘打开。
- worktree三门通过；目录为`E:\PenguinPravite\T8-penguin-canvas`，branch `codex/release-v3.0.8-volcengine-assets-ux`，起点HEAD `c663eaca9a00289b46e5aae565f653ef762796df`，common dir为本目录`.git`。

## 验证

- `npm run type-check`通过。
- `npm run i18n:check`通过：中英5430键，85节点覆盖，无新增硬编码可见中文。
- `npm run feature-sync:check`、上下文预算/原归档校验与`git diff --check`通过。翻译目录新增文案后，按项目生成器同步7份能力索引，仅更新翻译源与汇总摘要，39项动作/346运行目录项/85节点及全部能力语义不变。
- `node --import tsx --test tests/canvasTutorialPluginInstall.test.ts`：3/3通过。原3项测试仍按国际化前的硬编码标题查找，HEAD与本次工作树均不再含该旧形式；现改为核对真实翻译绑定、中文资源值与原顺序，保留所有原链接及插件打包合同，未改原入口来迎合旧测试。
- 真实浏览器运行生产组件：中文/英文、普通浅深色/像素主题、Enter打开、Escape/关闭按钮/外部点击关闭通过。320×480左右边缘分别实测浮层left=8、right=312、width=304，底部在视口内。
- 实际点击“前往贞贞小屋”后新标签页URL为`https://api.seedance.nz/?s=ibVH`，原浮层关闭；该验证只确认打开目标URL，不代表对目标站内容或服务可用性的审计。
- 本轮使用独立组件预览页，未加载完整App或后端、不访问用户画布数据库、不提交生成；没有停止已有11422开发服务。自建测试页面及跳转页均已关闭，临时视口已恢复。

证据位于忽略目录`local-private/cottage-promotion-20261108/`：`type-check.log`、`topbar-tests.log`、`ui-evidence.json`及`pixel.png`、`dark.png`、`light-en.png`、`narrow.png`、`preview.png`。当前功能已接入App，浏览器证据限于生产组件隔离验证，未冒称完整App或安装版验收。
