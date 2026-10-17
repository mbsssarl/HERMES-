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
    const orders = (await ctx.db.query("orders").filter((q) => q.eq(q.field("deletedAt"), undefined)).collect()).filter((o) => o.companyId === companyId);
    const orderIds = new Set(orders.map((o) => o._id));
    const quotations = (await ctx.db.query("quotations").collect()).filter((q) => orderIds.has(q.orderId));
    const recentActivity = (await ctx.db.query("activityLogs").order("desc").take(200)).filter((a) => a.companyId === companyId).slice(0, 20);

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
