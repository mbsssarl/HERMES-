import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/** The active user's profile (role, status, mustChangePassword...), or undefined while loading, null if signed out. */
export function useCurrentUser() {
  return useQuery(api.users.getCurrentUser);
}
