import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { FullPageLoader } from "../components/common/FullPageLoader";
import { useCurrentUser } from "../hooks/useCurrentUser";

export function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const user = useCurrentUser();

  if (user === undefined) return <FullPageLoader />;
  if (user === null || user.role !== "admin") return <Navigate to="/orders" replace />;

  return <>{children}</>;
}
