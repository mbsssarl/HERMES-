import { useQuery } from "convex/react";
import { History } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { EmptyState } from "@/components/common/EmptyState";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ActivityLogPage() {
  const logs = useQuery(api.activityLogs.list, { limit: 200 });

  if (logs === undefined) return <FullPageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader title="Journal d'activité" />

      <Card className="py-0">
        {logs.length === 0 ? (
          <EmptyState icon={<History />} title="Aucune activité enregistrée" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Entité</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log._id}>
                  <TableCell>{new Date(log.createdAt).toLocaleString("fr-FR")}</TableCell>
                  <TableCell>{log.action}</TableCell>
                  <TableCell>{log.entityType}</TableCell>
                  <TableCell className="font-mono text-xs">{log.entityId ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
