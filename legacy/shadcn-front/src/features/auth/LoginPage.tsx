import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { Anchor, MapPin } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/common/LoadingButton";

export function LoginPage() {
  const { signIn } = useAuthActions();
  const recordLogin = useMutation(api.users.recordLogin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn("password", { email, password, flow: "signIn" });
      await recordLogin({});
    } catch {
      toast.error("Email ou mot de passe incorrect.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout
      eyebrow="Portail employés"
      title={
        <>
          Bon retour à bord,
          <br />
          <span className="text-primary">équipage Hermès.</span>
        </>
      }
      description="Chaque commande servie commence par vous. Connectez-vous pour suivre les devis, les livraisons et le catalogue du jour."
    >
      <div className="mb-8 flex items-center gap-2.5">
        <div className="bg-primary/10 flex size-10 items-center justify-center rounded-xl">
          <Anchor className="text-primary size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Hermès · Ship Supply</p>
        </div>
      </div>

      <h1 className="text-2xl font-bold tracking-tight">Connexion</h1>
      <p className="text-muted-foreground mt-1 text-sm">Utilisez votre adresse professionnelle.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Adresse e-mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="prenom.nom@hermes.local"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Mot de passe</Label>
            <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
              <RouterLink to="/forgot-password">Mot de passe oublié ?</RouterLink>
            </Button>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <LoadingButton type="submit" size="lg" className="w-full" loading={loading}>
          Se connecter
        </LoadingButton>
      </form>

      <div className="text-muted-foreground mt-8 flex items-center gap-1.5 text-xs">
        <MapPin className="size-3.5" />
        Besoin d'aide ? Contactez votre administrateur.
      </div>
    </AuthSplitLayout>
  );
}
