import { Component, type ReactNode } from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';

/**
 * ErrorBoundary - 防御性错误边界
 *
 * 用途:
 *   1. 包裹 Canvas / 节点子树，捕获渲染期抛出的运行时异常
 *   2. 避免单个节点（如 OutputNode 在多源连接下）抛错把整页拖白屏
 *   3. 给用户一个可视的错误反馈 + 重置按钮，仍可继续操作其他画布
 */
interface Props extends WithTranslation {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error?: Error | null;
  info?: string;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // 控制台留痕方便排查
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info?.componentStack);
    this.setState({ info: info?.componentStack || '' });
  }

  reset = () => {
    this.setState({ hasError: false, error: null, info: '' });
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { t } = this.props;
    const title = this.props.fallbackTitle || t('render.title');
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 12,
          color: '#fca5a5',
          background: 'rgba(20,20,22,.92)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>🐧 {title}</div>
        <div style={{ fontSize: 13, opacity: 0.8, maxWidth: 720, textAlign: 'center' }}>
          {this.state.error?.message || t('render.unknown')}
        </div>
        {this.state.info && (
          <pre
            style={{
              fontSize: 11,
              maxWidth: 880,
              maxHeight: 240,
              overflow: 'auto',
              padding: 12,
              background: '#0008',
              borderRadius: 8,
              color: '#fda4af',
            }}
          >
            {this.state.info}
          </pre>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={this.reset}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #fca5a5',
              color: '#fca5a5',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            {t('render.retry')}
          </button>
          <button
            onClick={this.reload}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #5eead4',
              color: '#5eead4',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            {t('render.reload')}
          </button>
        </div>
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 8 }}>
          {t('render.report')}
        </div>
      </div>
    );
  }
}

export default withTranslation(['errors', 'common'])(ErrorBoundary);
