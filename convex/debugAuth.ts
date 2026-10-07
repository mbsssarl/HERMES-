import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";

// Même contournement de typage que dans users.ts : ces helpers n'ont besoin que de ctx.db, qu'un
// MutationCtx fournit déjà (confirmé à l'exécution), malgré leur signature TypeScript plus large.
function asAuthCtx(ctx: MutationCtx): Parameters<typeof createAccount>[0] {
  return ctx as unknown as Parameters<typeof createAccount>[0];
}

/**
 * Diagnostic (à lancer via `npx convex run debugAuth:checkAccount '{"email":"..."}'`) : vérifie qu'un compte
 * de connexion existe bien pour cet email et pointe vers un utilisateur valide, sans exposer le mot de passe
 * ni son empreinte. Utile après un export/import entre projets Convex pour localiser où ça coince.
 */
export const checkAccount = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", normalized))
      .unique();

    const userByEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();

    const totalUsers = (await ctx.db.query("users").collect()).length;
    const totalAccounts = (await ctx.db.query("authAccounts").collect()).length;

    return {
      normalizedEmail: normalized,
      // Le compte de connexion (provider "password") existe-t-il pour cet email exact ?
      authAccountFound: account !== null,
      accountPointsToUserId: account?.userId ?? null,
      // L'utilisateur (fiche compte) existe-t-il pour cet email ?
      userFound: userByEmail !== null,
      userId: userByEmail?._id ?? null,
      userStatus: userByEmail?.status ?? null,
      mustChangePassword: userByEmail?.mustChangePassword ?? null,
      // Les deux doivent pointer vers le même document : sinon la connexion échoue même avec le bon mot de passe.
      idsMatch: account !== null && userByEmail !== null ? account.userId === userByEmail._id : null,
      // A-t-on bien une empreinte de mot de passe enregistrée (sans la révéler) ?
      hasSecret: account !== null ? Boolean(account.secret) : null,
      // Repères généraux : le backup a-t-il seulement importé une partie des comptes ?
      totalUsersInDeployment: totalUsers,
      totalAuthAccountsInDeployment: totalAccounts,
    };
  },
});

/**
 * Réparation d'urgence (à lancer via `npx convex run debugAuth:recoverLogin '{"email":"...","newPassword":"..."}'`) :
 * remet un mot de passe fonctionnel pour ce compte, quel que soit l'état laissé par un export/import.
 * - Si le compte de connexion existe déjà : son mot de passe est simplement réinitialisé (le lien vers la
 *   fiche utilisateur est aussi réparé s'il ne pointait pas au bon endroit).
 * - S'il n'existe pas mais qu'une fiche utilisateur existe pour cet email (import partiel) : un compte de
 *   connexion est créé et rattaché à cette fiche existante, sans la dupliquer.
 * - Si rien n'existe pour cet email : rien n'est fait (utilisez `users:createUser` depuis un autre admin,
 *   ou `users:bootstrapFirstAdmin` si la table users est réellement vide).
 * Le nouveau mot de passe est à usage unique : la personne devra en choisir un autre à sa prochaine connexion.
 */
export const recoverLogin = internalMutation({
  args: { email: v.string(), newPassword: v.string() },
  handler: async (ctx, { email, newPassword }) => {
    if (newPassword.length < 8) throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    const normalized = email.trim().toLowerCase();

    const existingAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", normalized))
      .unique();
    const existingUser = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", normalized)).unique();

    if (existingAccount) {
      await modifyAccountCredentials(asAuthCtx(ctx), {
        provider: "password",
        account: { id: normalized, secret: newPassword },
      });
      if (existingUser && existingAccount.userId !== existingUser._id) {
        // L'import a laissé le compte de connexion pointer vers la mauvaise fiche : on répare le lien.
        await ctx.db.patch(existingAccount._id, { userId: existingUser._id });
      }
      if (existingUser) await ctx.db.patch(existingUser._id, { status: "active", mustChangePassword: true });
      return { action: "password_reset", userId: existingAccount.userId, hadUser: Boolean(existingUser) };
    }

    if (existingUser) {
      // Compte de connexion manquant (souvent : la table authAccounts n'a pas suivi l'import) — on le recrée
      // et on le rattache à la fiche utilisateur déjà présente, sans en créer une seconde.
      const { user } = await createAccount(asAuthCtx(ctx), {
        provider: "password",
        account: { id: normalized, secret: newPassword },
        profile: {
          email: normalized,
          role: existingUser.role,
          status: "active",
          mustChangePassword: true,
          createdAt: existingUser.createdAt,
        },
        shouldLinkViaEmail: true,
      });
      await ctx.db.patch(existingUser._id, { status: "active", mustChangePassword: true });
      return { action: "account_recreated_and_linked", userId: user._id };
    }

    throw new Error(
      `Aucune fiche utilisateur pour ${normalized} : l'import n'a rien apporté pour ce compte. ` +
        `Utilisez users:createUser (si un autre admin existe) ou users:bootstrapFirstAdmin (si la table users est vide).`,
    );
  },
});

/**
 * Supprime le mot de passe d'un compte (à lancer via `npx convex run debugAuth:clearPassword '{"email":"..."}'`) :
 * la personne pourra ensuite se connecter avec ce seul email (champ mot de passe laissé vide), puis devra
 * définir son propre mot de passe dès l'écran suivant (mustChangePassword). Fonctionne aussi si le compte de
 * connexion n'existe pas encore mais qu'une fiche utilisateur existe déjà pour cet email (il est alors créé,
 * rattaché à cette fiche, sans mot de passe).
 *
 * Fenêtre de sécurité : tant qu'aucun mot de passe n'est défini, N'IMPORTE QUI connaissant cet email peut se
 * connecter avec ce compte. À utiliser seulement pour un compte que la personne concernée va reprendre en
 * main immédiatement.
 */
export const clearPassword = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();

    const existingAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", normalized))
      .unique();
    const existingUser = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", normalized)).unique();

    if (existingAccount) {
      await ctx.db.patch(existingAccount._id, { secret: undefined });
      if (existingUser) await ctx.db.patch(existingUser._id, { status: "active", mustChangePassword: true });
      return { action: "password_cleared", userId: existingAccount.userId };
    }

    if (existingUser) {
      const { user } = await createAccount(asAuthCtx(ctx), {
        provider: "password",
        account: { id: normalized }, // pas de secret = pas de mot de passe
        profile: {
          email: normalized,
          role: existingUser.role,
          status: "active",
          mustChangePassword: true,
          createdAt: existingUser.createdAt,
        },
        shouldLinkViaEmail: true,
      });
      await ctx.db.patch(existingUser._id, { status: "active", mustChangePassword: true });
      return { action: "account_created_without_password", userId: user._id };
    }

    throw new Error(`Aucune fiche utilisateur pour ${normalized} : rien à faire.`);
  },
});
