import { useMutation } from "convex/react";
import { CheckCircle2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import { api } from "../../../convex/_generated/api";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/common/LoadingButton";

export function ForgotPasswordPage() {
  const requestReset = useMutation(api.users.requestPasswordReset);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await requestReset({ email });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout
      eyebrow="Récupération de compte"
      title={
        <>
          Pas de panique,
          <br />
          <span className="text-primary">on vous remet à quai.</span>
        </>
      }
      description="Saisissez votre adresse professionnelle : vous recevrez un lien sécurisé pour définir un nouveau mot de passe."
    >
      <h1 className="text-2xl font-bold tracking-tight">Mot de passe oublié</h1>

      {sent ? (
        <div className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 mt-6 flex items-start gap-2.5 rounded-lg border p-3.5 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Adresse e-mail professionnelle</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <LoadingButton type="submit" size="lg" className="w-full" loading={loading}>
            Envoyer le lien de réinitialisation
          </LoadingButton>
        </form>
      )}

      <Button asChild variant="outline" className="mt-3 w-full">
        <RouterLink to="/">← Retour à la connexion</RouterLink>
      </Button>
    </AuthSplitLayout>
  );
}
