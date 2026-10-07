import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
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
      // Un compte sans mot de passe défini (secret vide) est accepté quel que soit ce qui est
      // saisi : c'est le seul cas de connexion "sans mot de passe" - dès qu'un mot de passe est
      // défini (setNewPassword), ce chemin ne s'applique plus jamais à ce compte. Ça ne concerne
      // donc que les comptes créés/réinitialisés volontairement sans mot de passe (voir
      // debugAuth.clearPassword) - un compte normal continue d'exiger le bon mot de passe.
      crypto: {
        async hashSecret(password: string) {
          return await new Scrypt().hash(password);
        },
        async verifySecret(password: string, hash: string) {
          if (!hash) return true;
          return await new Scrypt().verify(hash, password);
        },
      },
    }),
  ],
});
