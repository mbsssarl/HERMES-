import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingButton } from "@/components/common/LoadingButton";

interface CompanyInfo {
  name?: string;
  address?: string;
  email?: string;
}

export function SettingsPage() {
  const defaultQuotationPercent = useQuery(api.settings.get, { key: "defaultQuotationPercent" });
  const companyInfoSetting = useQuery(api.settings.get, { key: "companyInfo" });
  const updateSetting = useMutation(api.settings.update);

  const [quotationPercent, setQuotationPercent] = useState("");
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({});
  const [savingQuotation, setSavingQuotation] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);

  useEffect(() => {
    if (typeof defaultQuotationPercent === "number") setQuotationPercent(String(defaultQuotationPercent));
  }, [defaultQuotationPercent]);
  useEffect(() => {
    if (companyInfoSetting && typeof companyInfoSetting === "object") setCompanyInfo(companyInfoSetting as CompanyInfo);
  }, [companyInfoSetting]);

  async function handleSaveQuotation() {
    setSavingQuotation(true);
    try {
      await updateSetting({ key: "defaultQuotationPercent", value: Number(quotationPercent) });
      toast.success("Paramètres enregistrés.");
    } finally {
      setSavingQuotation(false);
    }
  }

  async function handleSaveCompany() {
    setSavingCompany(true);
    try {
      await updateSetting({ key: "companyInfo", value: companyInfo });
      toast.success("Informations entreprise enregistrées.");
    } finally {
      setSavingCompany(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Paramètres" />

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Cotation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="quotation-percent">Cotation par défaut (%)</Label>
            <Input
              id="quotation-percent"
              type="number"
              value={quotationPercent}
              onChange={(e) => setQuotationPercent(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              La devise dépend du pays de chaque commande — voir Administration &gt; Pays
            </p>
          </div>
          <LoadingButton loading={savingQuotation} onClick={() => void handleSaveQuotation()}>
            Enregistrer
          </LoadingButton>
        </CardContent>
      </Card>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Informations entreprise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Nom</Label>
            <Input
              id="company-name"
              value={companyInfo.name ?? ""}
              onChange={(e) => setCompanyInfo((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-address">Adresse</Label>
            <Textarea
              id="company-address"
              rows={2}
              value={companyInfo.address ?? ""}
              onChange={(e) => setCompanyInfo((prev) => ({ ...prev, address: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-email">Email</Label>
            <Input
              id="company-email"
              value={companyInfo.email ?? ""}
              onChange={(e) => setCompanyInfo((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <LoadingButton loading={savingCompany} onClick={() => void handleSaveCompany()}>
            Enregistrer
          </LoadingButton>
        </CardContent>
      </Card>
    </div>
  );
}
