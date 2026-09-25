import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../../../convex/_generated/api";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/common/LoadingButton";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const resetPassword = useMutation(api.users.resetPasswordWithToken);

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
      await resetPassword({ token, newPassword: password });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <p className="text-destructive text-sm font-medium">Lien de réinitialisation invalide.</p>
      </div>
    );
  }

  return (
    <AuthSplitLayout
      eyebrow="Réinitialisation"
      title={
        <>
          Un nouveau départ,
          <br />
          <span className="text-primary">un nouveau mot de passe.</span>
        </>
      }
      description="Choisissez un mot de passe robuste : au moins 8 caractères."
    >
      <h1 className="text-2xl font-bold tracking-tight">Nouveau mot de passe</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
    </AuthSplitLayout>
  );
}
