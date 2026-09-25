import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { Button } from "@/components/ui/button";
import { AmbiguousItemsSection } from "./AmbiguousItemsSection";
import { ImportFilesCard } from "./ImportFilesCard";
import { MatchedItemsTable } from "./MatchedItemsTable";
import { OrderHeader } from "./OrderHeader";
import { QuotationSection } from "./QuotationSection";
import { UnmatchedItemsTable } from "./UnmatchedItemsTable";

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const id = orderId as Id<"orders">;

  const order = useQuery(api.orders.get, { orderId: id });
  const items = useQuery(api.orderItems.listByOrder, { orderId: id });

  if (order === undefined || items === undefined) return <FullPageLoader />;
  if (order === null) {
    return (
      <div>
        <h1 className="text-xl font-bold">Commande introuvable</h1>
        <Button onClick={() => navigate("/orders")} className="mt-4">
          Retour aux commandes
        </Button>
      </div>
    );
  }

  const matched = items.filter(
    (i) => i.matchStatus === "matched_impa" || i.matchStatus === "matched_name" || i.matchStatus === "manual",
  );
  const ambiguous = items.filter((i) => i.matchStatus === "ambiguous");
  const unmatched = items.filter((i) => i.matchStatus === "unmatched");
  const pricedCount = matched.filter((i) => i.unitPriceOriginal !== undefined).length;

  return (
    <div className="space-y-4">
      <OrderHeader order={order} />
      <ImportFilesCard orderId={id} />
      <AmbiguousItemsSection items={ambiguous} />
      <MatchedItemsTable items={matched} currency={order.country?.currency ?? "XAF"} />
      <UnmatchedItemsTable orderId={id} items={unmatched} />
      <QuotationSection orderId={id} clientEmail={order.client?.contactEmail} hasMatchedItems={pricedCount > 0} />
    </div>
  );
}
