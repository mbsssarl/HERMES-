import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Filet de sécurité des abonnements : la suspension à l'échéance est déjà planifiée au moment précis (platform.ts),
// cette tâche rattrape tout oubli.
crons.interval("expire due subscriptions", { hours: 1 }, internal.platform.expireDue, {});

export default crons;
