import { Component, type PropsWithChildren, type ReactNode } from "react";

type AppErrorBoundaryState = {
  hasError: boolean;
};

function SafeErrorFallback(): ReactNode {
  return (
    <main>
      <h1>No pudimos mostrar BCM SOFT</h1>
      <p>Recargá la página para volver a intentarlo.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Recargar
      </button>
    </main>
  );
}

export class AppErrorBoundary extends Component<
  PropsWithChildren,
  AppErrorBoundaryState
> {
  public state: AppErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public render(): ReactNode {
    return this.state.hasError ? <SafeErrorFallback /> : this.props.children;
  }
}

export function RouteErrorBoundary(): ReactNode {
  return <SafeErrorFallback />;
}
