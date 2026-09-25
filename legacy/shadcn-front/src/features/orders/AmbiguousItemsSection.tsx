import { useMutation } from "convex/react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type ItemWithCandidates = Doc<"orderItems"> & { ambiguousProducts: (Doc<"products"> | null)[] };

export function AmbiguousItemsSection({ items }: { items: ItemWithCandidates[] }) {
  const confirmMatch = useMutation(api.orderItems.confirmAmbiguousMatch);
  const clearMatch = useMutation(api.orderItems.clearMatch);

  if (items.length === 0) return null;

  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardContent className="space-y-4">
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert className="size-4" />
          <AlertTitle>Confirmation requise</AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-400">
            {items.length} ligne(s) nécessitent une confirmation de correspondance.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          {items.map((item) => (
            <div key={item._id}>
              <p className="text-sm font-semibold">
                {item.rawDescription} {item.rawCode ? `(${item.rawCode})` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {item.ambiguousProducts.filter(Boolean).map((product) => (
                  <Badge
                    key={product!._id}
                    variant="secondary"
                    className="hover:bg-primary hover:text-primary-foreground cursor-pointer"
                    onClick={() =>
                      void confirmMatch({ orderItemId: item._id, productId: product!._id }).then(() =>
                        toast.success("Correspondance confirmée."),
                      )
                    }
                  >
                    {product!.name}
                    {product!.impaId ? ` (${product!.impaId})` : ""} — {product!.unit}
                  </Badge>
                ))}
                <Badge
                  variant="outline"
                  className="hover:bg-accent cursor-pointer"
                  onClick={() => void clearMatch({ orderItemId: item._id })}
                >
                  Aucune correspondance
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
