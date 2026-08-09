import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import App from "./app/App";

// Red de seguridad: si algún error de render/efecto ocurre, se muestra en
// pantalla en lugar de quedarse en blanco/negro (facilita el diagnóstico).
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "#0B0B0E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", padding: 24 }}>
          <div style={{ maxWidth: 560 }}>
            <h2 style={{ marginBottom: 8 }}>Ocurrió un error al cargar la app</h2>
            <pre style={{ color: "#f87171", whiteSpace: "pre-wrap", fontSize: 12 }}>{this.state.error.message}</pre>
            <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 8 }}>Revisa la consola del navegador para más detalles.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
