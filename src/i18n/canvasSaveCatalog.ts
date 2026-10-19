export const canvasSaveZh = {
  title: '保存冲突',
  staleLoad: '加载结果落后于已确认保存的内容，已阻止旧画布回退。请重试加载。',
  detail: '后台保存或其他窗口更新了同一画布。系统只会自动合并互不冲突的修改；当前本地内容仍保留，尚未确认保存，请勿强制结束程序。',
  retry: '同步最新并重试', export: '下载本地副本', local: '保留本地修改并合并保存', server: '采用服务端版本',
  working: '处理中…', cancel: '取消', confirm: '确认处理',
  localConfirm: '仅冲突部分采用当前本地修改，其他服务端变化仍会合并。确定前可先下载本地副本；不会重新生成媒体。',
  serverConfirm: '这会放弃确认时已有的未保存本地修改，采用最新服务端内容。建议先下载本地副本。处理期间产生的新编辑仍会保留。',
  retryHint: '已尝试安全同步；如提示仍在，内容确有冲突或连接未恢复，请下载副本后选择处理方式。',
  failed: '处理未完成，本地修改仍保留；请检查连接后重试。',
  busySource: '画布连续被后台或其他窗口更新。为避免反复争抢已暂停自动重试；本地内容仍保留，请稍后点击顶部“同步最新并重试”。',
};
export const canvasSaveEn = {
  title: 'Save conflict',
  staleLoad: 'The loaded canvas is older than an acknowledged save. Older content was blocked; retry loading.',
  detail: 'A background save or another window updated this canvas. Only non-conflicting edits merge automatically. Local content is retained but saving is unconfirmed; do not force-quit.',
  retry: 'Sync latest and retry', export: 'Download local copy', local: 'Keep local edits and merge', server: 'Use server version',
  working: 'Working…', cancel: 'Cancel', confirm: 'Confirm resolution',
  localConfirm: 'Use current local edits for conflicting fields and merge other server changes. You can download a local copy first. No media will be regenerated.',
  serverConfirm: 'This discards existing unsaved local edits at confirmation and adopts the latest server content. Download a local copy first. New edits made during resolution are retained.',
  retryHint: 'Safe sync attempted. If this notice remains, content conflicts or the connection still needs attention. Download a copy and choose a resolution.',
  failed: 'Resolution was not completed. Local edits are retained; check the connection and retry.',
  busySource: 'Background work or another window keeps updating this canvas. Automatic retries are paused to prevent contention. Local edits are retained; use Sync latest and retry later.',
};
