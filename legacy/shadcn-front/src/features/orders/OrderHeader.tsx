import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { OrderStatusChip } from "@/components/common/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "processing", label: "En traitement" },
  { value: "awaiting_supplier", label: "Attente fournisseur" },
  { value: "completed", label: "Terminé" },
  { value: "sent", label: "Envoyée" },
  { value: "archived", label: "Archivée" },
];

type OrderWithClient = Doc<"orders"> & {
  client: Doc<"clients"> | null;
  country: Doc<"countries"> | null;
};

export function OrderHeader({ order }: { order: OrderWithClient }) {
  const user = useCurrentUser();
  const updateStatus = useMutation(api.orders.updateStatus);
  const setQuotationOverride = useMutation(api.orders.setQuotationOverride);
  const setGlobalDiscount = useMutation(api.orders.setGlobalDiscount);
  const updateLogistics = useMutation(api.orders.updateLogistics);

  const [quotationInput, setQuotationInput] = useState(String(order.quotationPercentOverride ?? ""));
  const [discountInput, setDiscountInput] = useState(String(order.globalDiscountPercent ?? ""));
  const [vessel, setVessel] = useState(order.vessel ?? "");
  const [eta, setEta] = useState(order.eta ?? "");
  const [supplyPlace, setSupplyPlace] = useState(order.supplyPlace ?? "");
  const [clientOrderNumber, setClientOrderNumber] = useState(order.clientOrderNumber ?? "");

  // Vessel/port/reference can be auto-filled a few seconds later, once the
  // imported document finishes analysing — sync from the (reactive) order
  // as long as the user hasn't already typed something in that field.
  useEffect(() => {
    if (!vessel && order.vessel) setVessel(order.vessel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.vessel]);
  useEffect(() => {
    if (!supplyPlace && order.supplyPlace) setSupplyPlace(order.supplyPlace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.supplyPlace]);
  useEffect(() => {
    if (!clientOrderNumber && order.clientOrderNumber) setClientOrderNumber(order.clientOrderNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.clientOrderNumber]);

  async function handleStatusChange(status: string) {
    await updateStatus({ orderId: order._id, status: status as never });
  }

  async function handleQuotationBlur() {
    const value = quotationInput.trim() === "" ? undefined : Number(quotationInput);
    try {
      await setQuotationOverride({ orderId: order._id, percent: value });
      toast.success("Cotation mise à jour.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function handleDiscountBlur() {
    const value = discountInput.trim() === "" ? undefined : Number(discountInput);
    try {
      await setGlobalDiscount({ orderId: order._id, percent: value });
      toast.success("Réduction mise à jour.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    }
  }

  async function handleLogisticsBlur() {
    try {
      await updateLogistics({
        orderId: order._id,
        vessel: vessel.trim() || undefined,
        eta: eta || undefined,
        supplyPlace: supplyPlace.trim() || undefined,
        clientOrderNumber: clientOrderNumber.trim() || undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{order.reference}</h1>
            <p className="text-muted-foreground text-sm">{order.client?.name ?? "Client inconnu"}</p>
            {order.country && (
              <Badge variant="outline" className="mt-2">
                {order.country.name} · {order.country.currency}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="w-48">
              <Select value={order.status} onValueChange={(v) => void handleStatusChange(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {user?.role === "admin" && (
              <>
                <div className="w-36">
                  <Label className="mb-1.5 text-xs">Cotation (%)</Label>
                  <Input
                    type="number"
                    value={quotationInput}
                    onChange={(e) => setQuotationInput(e.target.value)}
                    onBlur={handleQuotationBlur}
                  />
                </div>
                <div className="w-36">
                  <Label className="mb-1.5 text-xs">Réduction (%)</Label>
                  <Input
                    type="number"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    onBlur={handleDiscountBlur}
                  />
                </div>
              </>
            )}

            <OrderStatusChip status={order.status} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-t pt-4">
          <div className="w-48">
            <Label className="mb-1.5 text-xs">N° commande client</Label>
            <Input
              value={clientOrderNumber}
              onChange={(e) => setClientOrderNumber(e.target.value)}
              onBlur={handleLogisticsBlur}
            />
          </div>
          <div className="w-48">
            <Label className="mb-1.5 text-xs">Navire</Label>
            <Input value={vessel} onChange={(e) => setVessel(e.target.value)} onBlur={handleLogisticsBlur} />
          </div>
          <div className="w-40">
            <Label className="mb-1.5 text-xs">ETA</Label>
            <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} onBlur={handleLogisticsBlur} />
          </div>
          <div className="w-56">
            <Label className="mb-1.5 text-xs">Port / lieu de livraison</Label>
            <Input value={supplyPlace} onChange={(e) => setSupplyPlace(e.target.value)} onBlur={handleLogisticsBlur} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
