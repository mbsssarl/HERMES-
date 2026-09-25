import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/query errors anywhere below it (e.g. a Convex function
 * missing on the backend) and shows a readable message instead of an
 * uncaught error leaving a blank white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="text-destructive size-10" />
        <p className="text-lg font-semibold">Une erreur est survenue</p>
        <p className="text-muted-foreground max-w-md text-sm break-words">{error.message}</p>
        <Button onClick={() => this.setState({ error: null })}>Réessayer</Button>
      </div>
    );
  }
}
