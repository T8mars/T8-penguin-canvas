import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, ExternalLink, X } from 'lucide-react';
import {
  JIMENG_CLI_INSTALL_UPDATE_COMMAND,
  JIMENG_CLI_LOGIN_COMMANDS,
  JIMENG_CLI_OFFICIAL_GUIDE_URL,
  JIMENG_CLI_RELEASE_DATE,
  JIMENG_CLI_SUPPORTED_VERSION,
} from '../../config/jimengCli';

const Command = ({ children }: { children: string }) => (
  <code className="block overflow-x-auto rounded border border-lime-300/20 bg-black/35 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-lime-100">
    {children}
  </code>
);

const openOfficialGuide = async () => {
  if (typeof window === 'undefined') return;
  if (typeof window.t8pc?.openExternal === 'function') {
    try {
      const result = await window.t8pc.openExternal(JIMENG_CLI_OFFICIAL_GUIDE_URL);
      if (result?.success) return;
    } catch {
      // Browser fallback below keeps the help link usable in web development mode.
    }
  }
  window.open(JIMENG_CLI_OFFICIAL_GUIDE_URL, '_blank', 'noopener,noreferrer');
};

export default function JimengCliHelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="nodrag nowheel flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-lime-300/25 bg-lime-400/10 text-lime-100 transition hover:border-lime-200/60 hover:bg-lime-300/20"
        aria-label="查看即梦 CLI 登录、退出和更新方法"
        title={`即梦 CLI 帮助 · 当前适配 v${JIMENG_CLI_SUPPORTED_VERSION}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <CircleHelp size={16} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="即梦 CLI 使用帮助"
            className="nodrag nowheel max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-lime-300/25 bg-[#10170e] text-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/10 bg-[#10170e]/95 px-4 py-3 backdrop-blur">
              <CircleHelp className="mt-0.5 shrink-0 text-lime-300" size={20} />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-white">即梦 CLI 登录、退出与版本匹配</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                  当前图像、视频和 SD2.0 节点按 <strong className="text-lime-200">v{JIMENG_CLI_SUPPORTED_VERSION}</strong>
                  （{JIMENG_CLI_RELEASE_DATE}）命令契约适配。版本过旧可能出现参数不认识、任务完成但查询异常或无法下载结果。
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-white/10 p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                aria-label="关闭即梦 CLI 帮助"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-4 px-4 py-4 text-xs leading-relaxed text-white/75">
              <div className="rounded-lg border border-amber-300/20 bg-amber-400/10 p-3">
                <div className="font-bold text-amber-100">1. 安装或更新到当前适配版本</div>
                <p className="my-2 text-white/65">安装和更新使用同一条官方命令。更新后重新启动 T8 开发服务或 Electron。</p>
                <Command>{JIMENG_CLI_INSTALL_UPDATE_COMMAND}</Command>
                <p className="mt-2 text-[11px] text-white/50">
                  当前 v{JIMENG_CLI_SUPPORTED_VERSION} 契约要求图片显式提供 resolution_type、视频显式提供 video_resolution；Seedance 2.5 可选 480P / 720P / 1080P 与 4-30 秒，本节点已按模型逐项校验。
                </p>
              </div>

              <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/[0.07] p-3">
                <div className="font-bold text-cyan-100">2. 普通登录</div>
                <div className="mt-2 space-y-2">
                  <Command>{JIMENG_CLI_LOGIN_COMMANDS.login}</Command>
                  <ol className="list-decimal space-y-1 pl-5 text-white/65">
                    <li>复制终端打印的 verification_uri，在浏览器打开。</li>
                    <li>输入终端里的 user_code 并确认授权。</li>
                    <li>回到终端等待登录完成，再运行下面命令确认账号与积分。</li>
                  </ol>
                  <Command>{JIMENG_CLI_LOGIN_COMMANDS.verify}</Command>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="font-bold text-white">3. 无浏览器环境登录</div>
                <div className="mt-2 space-y-2">
                  <Command>{JIMENG_CLI_LOGIN_COMMANDS.headless}</Command>
                  <p className="text-white/60">在可用浏览器完成授权后，用终端返回的 device_code 检查：</p>
                  <Command>{JIMENG_CLI_LOGIN_COMMANDS.checkLogin}</Command>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="font-bold text-white">切换账号 / 重新登录</div>
                  <p className="my-2 text-white/55">清除本机 OAuth 状态后立即开始一次新登录。</p>
                  <Command>{JIMENG_CLI_LOGIN_COMMANDS.relogin}</Command>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <div className="font-bold text-white">退出登录</div>
                  <p className="my-2 text-white/55">只清除本机 OAuth 登录状态，不删除任务记录或本地配置。</p>
                  <Command>{JIMENG_CLI_LOGIN_COMMANDS.logout}</Command>
                </div>
              </div>

              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded border border-lime-300/25 bg-lime-400/10 px-3 py-2 font-semibold text-lime-100 hover:bg-lime-300/20"
                onClick={() => void openOfficialGuide()}
              >
                打开即梦 CLI 官方文档 <ExternalLink size={13} />
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
