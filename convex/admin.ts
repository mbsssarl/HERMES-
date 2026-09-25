import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireAdmin } from "./lib/permissions";

export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const users = await ctx.db.query("users").collect();
    const orders = await ctx.db.query("orders").filter((q) => q.eq(q.field("deletedAt"), undefined)).collect();
    const quotations = await ctx.db.query("quotations").collect();
    const recentActivity = await ctx.db.query("activityLogs").order("desc").take(20);

    const ordersByStatus = orders.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {});

    // Revenue = grand total of the latest quotation per sent order.
    const latestQuotationByOrder = new Map<Id<"orders">, (typeof quotations)[number]>();
    for (const q of quotations) {
      const existing = latestQuotationByOrder.get(q.orderId);
      if (!existing || q.version > existing.version) latestQuotationByOrder.set(q.orderId, q);
    }
    const sentOrderIds = new Set(orders.filter((o) => o.status === "sent").map((o) => o._id));
    let totalRevenue = 0;
    for (const [orderId, quotation] of latestQuotationByOrder) {
      if (sentOrderIds.has(orderId)) totalRevenue += quotation.grandTotal;
    }

    return {
      users: {
        total: users.length,
        active: users.filter((u) => u.status === "active").length,
        disabled: users.filter((u) => u.status === "disabled").length,
      },
      orders: {
        total: orders.length,
        byStatus: ordersByStatus,
      },
      totalRevenue,
      recentActivity,
    };
  },
});
