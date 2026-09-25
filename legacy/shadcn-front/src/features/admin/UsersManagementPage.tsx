import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingButton } from "@/components/common/LoadingButton";

export function UsersManagementPage() {
  const users = useQuery(api.users.listUsers, {});
  const createUser = useMutation(api.users.createUser);
  const toggleStatus = useMutation(api.users.toggleUserStatus);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await createUser({ email: email.trim() });
      toast.success("Utilisateur créé, email envoyé.");
      setDialogOpen(false);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(userId: Id<"users">, currentStatus: string) {
    try {
      await toggleStatus({ userId, status: currentStatus === "active" ? "disabled" : "active" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    }
  }

  if (users === undefined) return <FullPageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Utilisateurs"
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus /> Nouvel utilisateur
          </Button>
        }
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Dernière connexion</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actif</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u._id}>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{u.role === "admin" ? "Admin" : "Utilisateur"}</Badge>
                </TableCell>
                <TableCell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR") : "Jamais"}</TableCell>
                <TableCell>
                  <Badge variant={u.status === "active" ? "success" : "outline"}>
                    {u.status === "active" ? "Actif" : "Désactivé"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Switch checked={u.status === "active"} onCheckedChange={() => void handleToggle(u._id, u.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Nouvel utilisateur</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-email">Email</Label>
            <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <LoadingButton loading={loading} onClick={() => void handleCreate()}>
              Créer
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
