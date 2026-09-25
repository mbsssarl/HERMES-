import type { ReactNode } from "react";
import { FullPageLoader } from "../../components/common/FullPageLoader";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { SetPasswordPage } from "./SetPasswordPage";

/** Blocks the whole app behind a forced password change when the account still uses a temporary password. */
export function SetPasswordGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser();

  if (user === undefined) return <FullPageLoader />;
  if (user === null) return <FullPageLoader />; // auth state settling
  if (user.mustChangePassword) return <SetPasswordPage forced />;

  return <>{children}</>;
}
