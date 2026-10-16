import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";

// Authentification par email + mot de passe. Aucune inscription publique : les comptes sont créés par un
// administrateur (users.createUser). Le hachage est celui par défaut de Convex Auth (Scrypt) : les comptes
// existants (y compris importés depuis un backup) restent valides.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      // Atteint uniquement si le flux d'inscription libre "signUp" était appelé (il ne l'est pas : voir
      // users.createUser). Conservé conforme au schéma par sécurité.
      profile(params) {
        return {
          email: (params.email as string).trim().toLowerCase(),
          role: "user",
          status: "active",
          mustChangePassword: true,
          createdAt: Date.now(),
        };
      },
    }),
  ],
});
