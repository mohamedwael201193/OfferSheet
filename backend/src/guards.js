// Quota guards — adopted design settings, NOT Qloo-stated quotas.
// No numeric Qloo quota exists anywhere in the guide; these values are this
// product's own tripwires, labeled as such in the README and the UI.
// Counters are in-memory (they reset on restart); persistent counters are a
// documented deploy-time improvement, not a claimed feature.
import { quotaFloorTripped, visitorCapTripped, runCapTripped } from './errors.js';

export class Guards {
  constructor({ monthlyBudget = 1500, perVisitorDailyCap = 20, perRunCallCap = 40 } = {}) {
    this.monthlyBudget = monthlyBudget;
    this.perVisitorDailyCap = perVisitorDailyCap;
    this.perRunCallCap = perRunCallCap;
    this.monthlyCount = 0;
    this.monthKey = new Date().toISOString().slice(0, 7);
    this.visitorCounts = new Map();
    this.perRunCount = 0;
  }

  resetRun() {
    this.perRunCount = 0;
  }

  // Called before every live Qloo call (MCP or REST). Trips are fail-closed.
  checkCall() {
    const monthKey = new Date().toISOString().slice(0, 7);
    if (monthKey !== this.monthKey) {
      this.monthKey = monthKey;
      this.monthlyCount = 0;
    }
    if (this.monthlyCount >= this.monthlyBudget) throw quotaFloorTripped();
    if (this.perRunCount >= this.perRunCallCap) throw runCapTripped();
    this.monthlyCount += 1;
    this.perRunCount += 1;
  }

  checkVisitor(ip) {
    const dayKey = new Date().toISOString().slice(0, 10);
    // G10: prune by day so the map stays bounded — yesterday's entries are
    // dead weight, and the map must never grow unboundedly across days.
    for (const key of this.visitorCounts.keys()) {
      if (!key.endsWith(`:${dayKey}`)) this.visitorCounts.delete(key);
    }
    // Hard bound on distinct visitors in one day (oldest entries go first).
    while (this.visitorCounts.size >= 5000) {
      this.visitorCounts.delete(this.visitorCounts.keys().next().value);
    }
    const key = `${ip}:${dayKey}`;
    const count = this.visitorCounts.get(key) || 0;
    if (count >= this.perVisitorDailyCap) throw visitorCapTripped();
    this.visitorCounts.set(key, count + 1);
  }

  snapshot() {
    return {
      monthlyBudget: this.monthlyBudget,
      monthlyCount: this.monthlyCount,
      perVisitorDailyCap: this.perVisitorDailyCap,
      perRunCallCap: this.perRunCallCap,
    };
  }
}
