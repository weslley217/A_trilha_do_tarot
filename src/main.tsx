import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Erro desconhecido ao renderizar o aplicativo.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Runtime error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen-center">
          <div className="auth-card">
            <p className="eyebrow">A Trilha do Tarot</p>
            <h1>Falha ao carregar o app</h1>
            <p className="error-text">{this.state.message}</p>
            <p className="muted">Revise as variaveis da Vercel e recarregue a pagina.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

