/**
 * limit_enforcer.js
 * Standalone middleware and service to enforce user-configured daily and monthly API borders.
 * Reads configuration from api_limits.json and tracks usage in SQLite / D1.
 */

import limitsConfig from './api_limits.json' assert { type: 'json' };

export class LimitEnforcer {
  constructor(db, customLimits = {}) {
    this.db = db;
    this.dailyLimit = customLimits.daily_ai_limit ?? limitsConfig.daily_ai_limit;
    this.monthlyLimit = customLimits.monthly_ai_limit ?? limitsConfig.monthly_ai_limit;
  }

  getRiyadhDateStrings() {
    const now = new Date();
    const riyadhOffsetMs = 3 * 60 * 60 * 1000;
    const riyadhTime = new Date(now.getTime() + riyadhOffsetMs);
    const dateStr = riyadhTime.toISOString().slice(0, 10);
    const monthStr = dateStr.slice(0, 7);
    return { dateStr, monthStr };
  }

  async checkLimits(endpoint = 'chat') {
    const { dateStr, monthStr } = this.getRiyadhDateStrings();

    // Query daily count
    const dailyRow = await this.db.prepare(
      `SELECT COUNT(*) AS count FROM api_usage_logs WHERE date(created_at) = ?`
    ).bind(dateStr).first();
    const todayCount = dailyRow ? Number(dailyRow.count) : 0;

    // Query monthly count
    const monthRow = await this.db.prepare(
      `SELECT COUNT(*) AS count FROM api_usage_logs WHERE strftime('%Y-%m', created_at) = ?`
    ).bind(monthStr).first();
    const monthCount = monthRow ? Number(monthRow.count) : 0;

    // Daily enforcement
    if (this.dailyLimit > 0 && todayCount >= this.dailyLimit) {
      const err = new Error(`Daily border reached (${todayCount}/${this.dailyLimit} calls). Update borders in Settings to continue.`);
      err.statusCode = 429;
      err.code = 'DAILY_LIMIT_EXCEEDED';
      err.todayCount = todayCount;
      err.dailyLimit = this.dailyLimit;
      throw err;
    }

    // Monthly enforcement
    if (this.monthlyLimit > 0 && monthCount >= this.monthlyLimit) {
      const err = new Error(`Monthly border reached (${monthCount}/${this.monthlyLimit} calls). Update borders in Settings to continue.`);
      err.statusCode = 429;
      err.code = 'MONTHLY_LIMIT_EXCEEDED';
      err.monthCount = monthCount;
      err.monthlyLimit = this.monthlyLimit;
      throw err;
    }

    return {
      allowed: true,
      todayCount,
      dailyLimit: this.dailyLimit,
      monthCount,
      monthlyLimit: this.monthlyLimit
    };
  }

  async recordUsage(provider, model, endpoint = 'chat') {
    const id = `use_${crypto.randomUUID().slice(0, 8)}`;
    await this.db.prepare(
      `INSERT INTO api_usage_logs (id, provider, model, endpoint, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(id, provider, model, endpoint).run();
  }
}
