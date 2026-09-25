import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/common/LoadingButton";

function SetPasswordForm({ forced }: { forced: boolean }) {
  const setNewPassword = useMutation(api.users.setNewPassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      await setNewPassword({ newPassword: password });
      if (!forced) toast.success("Mot de passe mis à jour.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
        <p className="text-muted-foreground text-xs">8 caractères minimum</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirmer le mot de passe</Label>
        <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <LoadingButton type="submit" size="lg" className="w-full" loading={loading}>
        Valider
      </LoadingButton>
    </form>
  );
}

export function SetPasswordPage({ forced }: { forced: boolean }) {
  if (!forced) {
    return (
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Changer de mot de passe</CardTitle>
          <CardDescription>Définissez un nouveau mot de passe pour votre compte.</CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm forced={false} />
        </CardContent>
      </Card>
    );
  }

  return (
    <AuthSplitLayout
      eyebrow="Première connexion"
      title={
        <>
          Sécurisons
          <br />
          <span className="text-primary">votre compte.</span>
        </>
      }
      description="Votre mot de passe temporaire doit être remplacé avant de continuer."
    >
      <h1 className="text-2xl font-bold tracking-tight">Définissez votre mot de passe</h1>
      <div className="mt-6">
        <SetPasswordForm forced />
      </div>
    </AuthSplitLayout>
  );
}
