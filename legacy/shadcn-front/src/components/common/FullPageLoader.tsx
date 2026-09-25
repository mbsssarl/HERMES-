import { Loader2 } from "lucide-react";

export function FullPageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="text-primary size-8 animate-spin" />
    </div>
  );
}
