import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { companyIdOf, requireAdmin } from "./lib/permissions";

export const getDashboardStats = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const companyId = companyIdOf(admin);

    // Tout est limité à l'entreprise de l'admin.
    const users = await ctx.db.query("users").withIndex("by_company", (q) => q.eq("companyId", companyId)).collect();
    const orders = (await ctx.db.query("orders").withIndex("by_company", (q) => q.eq("companyId", companyId)).collect()).filter((o) => o.deletedAt === undefined);
    const quotations = (await Promise.all(orders.map((o) => ctx.db.query("quotations").withIndex("by_order", (q) => q.eq("orderId", o._id)).collect()))).flat();
    const recentActivity = await ctx.db.query("activityLogs").withIndex("by_company", (q) => q.eq("companyId", companyId)).order("desc").take(20);

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
