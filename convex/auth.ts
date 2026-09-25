import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      // Only reached if the low-level self-service "signUp" flow were ever
      // invoked (it isn't - accounts are admin-provisioned via
      // users.createUser, which calls createAccount directly with its own
      // explicit profile). Kept schema-valid as a safety net.
      profile(params) {
        return {
          email: params.email as string,
          role: "user",
          status: "active",
          mustChangePassword: true,
          createdAt: Date.now(),
        };
      },
    }),
  ],
});
