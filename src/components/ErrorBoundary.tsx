import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('页面渲染错误:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <h2 style={{ color: '#CC0000', marginBottom: 16 }}>页面加载出错</h2>
          <p style={{ color: '#666', marginBottom: 8 }}>错误信息：</p>
          <pre
            style={{
              background: '#f5f5f5',
              padding: 16,
              borderRadius: 8,
              textAlign: 'left',
              fontSize: 13,
              maxHeight: 200,
              overflow: 'auto',
              color: '#333',
            }}
          >
            {this.state.error?.message || '未知错误'}
          </pre>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: 16,
              padding: '8px 24px',
              background: '#CC0000',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
