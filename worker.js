/**
 * MazenOS Cloudflare Worker Backend (worker.js)
 * Central HTTP API Router, Unified Auth Middleware, MacroDroid /status Loop,
 * Consecutive Task Cascading Engine, Bank SMS Regex Parser & 03:00 AM Cron Engine.
 */

import {
  buildCompactState,
  runAgentChat,
  evaluateTaskProof,
  evaluateMediaRelevance,
  synthesizeIdeasMarkdown
} from './worker-ai.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MacroDroid-Token'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

function getRiyadhDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${map.hour}:${map.minute}`,
    isoRiyadh: `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+03:00`,
    weekday: map.weekday,
    minutesOfDay: parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10)
  };
}

function isWithinRestWindow(minutesOfDay, restWindowStr = '12:30 - 13:15') {
  const match = String(restWindowStr).match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const startMins = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const endMins = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
  return minutesOfDay >= startMins && minutesOfDay <= endMins;
}

/**
 * Unified Bearer Auth & MacroDroid Token Verification
 */
async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const macroHeader = request.headers.get('X-MacroDroid-Token') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  const providedToken = bearer || macroHeader;

  const rows = await env.DB.prepare(
    `SELECT key, value FROM system_settings WHERE key IN ('master_password', 'macrodroid_token')`
  ).all();

  const stored = {};
  for (const r of (rows.results || [])) {
    if (r.value) stored[r.key] = r.value;
  }

  // If no password or token is configured yet (initial unified setup), allow request
  if (!stored.master_password && !stored.macrodroid_token) {
    return { authorized: true };
  }

  if (
    (stored.master_password && providedToken === stored.master_password) ||
    (stored.macrodroid_token && providedToken === stored.macrodroid_token)
  ) {
    return { authorized: true };
  }

  return { authorized: false };
}

/**
 * Consecutive Cascading Engine:
 * Shifts all downstream consecutive tasks forward when a parent task slips or is rescheduled.
 */
async function cascadeConsecutiveTasks(env, parentTaskId, shiftMinutes) {
  if (!shiftMinutes || shiftMinutes === 0) return [];
  const shiftedIds = [];
  const queue = [parentTaskId];
  const visited = new Set([parentTaskId]);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = await env.DB.prepare(
      `SELECT id, due_timestamp, is_consecutive FROM tasks
       WHERE depends_on_task_id = ? AND status IN ('pending', 'in_progress')`
    ).bind(currentId).all();

    for (const child of (children.results || [])) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (child.is_consecutive && child.due_timestamp) {
        const oldMs = Date.parse(child.due_timestamp);
        if (!Number.isNaN(oldMs)) {
          const newIso = new Date(oldMs + shiftMinutes * 60000).toISOString();
          await env.DB.prepare(
            `UPDATE tasks SET due_timestamp = ? WHERE id = ?`
          ).bind(newIso, child.id).run();
          shiftedIds.push({ id: child.id, new_due_timestamp: newIso });
        }
      }
      queue.push(child.id);
    }
  }
  return shiftedIds;
}

/**
 * Zero-Cost Bank SMS Regex Parser for Saudi & Regional Banks
 */
export function parseBankSms(rawSms) {
  const text = String(rawSms || '').trim();

  // Amount in SAR (e.g. "SAR 42.50", "42.50 SAR", "مبلغ: SAR 120.00", "Amount: 18.00 SAR")
  const amountMatch =
    text.match(/(?:SAR|SR|ريال)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i) ||
    text.match(/([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:SAR|SR|ريال)/i);
  const amountSar = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

  // Card / Wallet extraction (e.g. "*4821", "Card: 4821", "بطاقة: 4821", "ApplePay", "mada")
  const cardMatch =
    text.match(/(?:Card|بطاقة|mada|مدى|Visa|MasterCard)[^0-9*]*\*?(\d{4})/i) ||
    text.match(/\*(\d{4})/);
  const walletSource = cardMatch ? `Card *${cardMatch[1]}` : 'Bank SMS';

  // Merchant extraction (e.g. "at: Camel Step", "لدى: خطوة جمل", "Merchant: Jarir")
  const merchantMatch =
    text.match(/(?:at|Merchant|لدى|لـ)\s*[:\-]?\s*([^\n\r.;|]+)/i);
  const merchant = merchantMatch ? merchantMatch[1].trim().slice(0, 60) : 'POS Purchase';

  // Remaining balance extraction (e.g. "Balance: SAR 88.33", "الرصيد: 88.33 ريال", "Avail Bal: 88.33")
  const balanceMatch =
    text.match(/(?:Balance|Bal|Avail|الرصيد)[^0-9]*(?:SAR|SR)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i);
  const balanceAfterSar = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : null;

  // Timestamp extraction or current time
  const dateMatch = text.match(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
  const transactionTimestamp = dateMatch ? dateMatch[1] : new Date().toISOString();

  return {
    wallet_source: walletSource,
    merchant,
    amount_sar: amountSar,
    balance_after_sar: balanceAfterSar,
    transaction_timestamp: transactionTimestamp
  };
}

/**
 * Evaluate Hardware Lock Status (/status)
 */
async function getHardwareStatus(env) {
  const riyadh = getRiyadhDateParts();

  // Check KV override flag first if bound
  if (env.KV) {
    const kvOverride = await env.KV.get('device_unlocked_override');
    if (kvOverride === 'true') {
      return { device_unlocked: true, reason: 'Manual or sickness override active', riyadh_time: riyadh.timeStr };
    }
  }

  // Check Sickness Protocol in daily_health_logs
  const healthRow = await env.DB.prepare(
    `SELECT is_sick, sleep_hours, energy_score FROM daily_health_logs WHERE date = ?`
  ).bind(riyadh.dateStr).first();

  if (healthRow && Boolean(healthRow.is_sick)) {
    return {
      device_unlocked: true,
      reason: 'Sickness protocol active — recovery prioritized',
      riyadh_time: riyadh.timeStr
    };
  }

  // Friday Builder Safeguard: Fridays are protected for hobbies & builder work
  if (riyadh.weekday === 'Fri') {
    return {
      device_unlocked: true,
      reason: 'Friday Builder & Hobby Day Protection',
      riyadh_time: riyadh.timeStr
    };
  }

  // Rest window check
  const restSetting = await env.DB.prepare(
    `SELECT value FROM system_settings WHERE key = 'rest_window'`
  ).first();
  const restWindow = restSetting ? restSetting.value : '12:30 - 13:15';
  if (isWithinRestWindow(riyadh.minutesOfDay, restWindow)) {
    return {
      device_unlocked: true,
      reason: `Inside scheduled rest window (${restWindow})`,
      riyadh_time: riyadh.timeStr
    };
  }

  // Overdue P1 task check
  const activeP1 = await env.DB.prepare(
    `SELECT id, title, due_timestamp, requires_video FROM tasks
     WHERE status IN ('pending', 'in_progress') AND priority = 1
     ORDER BY CASE WHEN due_timestamp IS NULL THEN 1 ELSE 0 END, due_timestamp ASC LIMIT 1`
  ).first();

  if (activeP1 && activeP1.due_timestamp) {
    const dueMs = Date.parse(activeP1.due_timestamp);
    if (!Number.isNaN(dueMs) && Date.now() > dueMs) {
      return {
        device_unlocked: false,
        reason: `Overdue P1 Task: ${activeP1.title}`,
        active_p1: activeP1,
        riyadh_time: riyadh.timeStr
      };
    }
  }

  return {
    device_unlocked: true,
    reason: 'All P1 milestones on track',
    active_p1: activeP1 || null,
    riyadh_time: riyadh.timeStr
  };
}


/**
 * Custom AI Credit Protection: Enforces User-Configured Daily & Monthly Borders
 */
async function checkApiUsageLimits(env, endpoint = 'chat') {
  const riyadh = getRiyadhDateParts();
  const monthPrefix = riyadh.dateStr.slice(0, 7); // YYYY-MM

  // Fetch user-defined limits from system_settings
  const limitSettings = await env.DB.prepare(
    `SELECT key, value FROM system_settings WHERE key IN ('daily_ai_limit', 'monthly_ai_limit')`
  ).all();

  const limits = { daily_ai_limit: 50, monthly_ai_limit: 1000 };
  for (const r of (limitSettings.results || [])) {
    if (r.value !== '' && r.value !== null) limits[r.key] = Number(r.value);
  }

  // Count usage today
  const todayRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM api_usage_logs WHERE date(created_at) = ?`
  ).bind(riyadh.dateStr).first();
  const todayCount = todayRow ? Number(todayRow.count) : 0;

  // Count usage this month
  const monthRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM api_usage_logs WHERE strftime('%Y-%m', created_at) = ?`
  ).bind(monthPrefix).first();
  const monthCount = monthRow ? Number(monthRow.count) : 0;

  if (limits.daily_ai_limit > 0 && todayCount >= limits.daily_ai_limit) {
    const err = new Error(`Daily AI limit reached (${todayCount}/${limits.daily_ai_limit}). Adjust border in Settings to continue.`);
    err.code = 'DAILY_LIMIT_EXCEEDED';
    err.today_count = todayCount;
    err.daily_limit = limits.daily_ai_limit;
    throw err;
  }

  if (limits.monthly_ai_limit > 0 && monthCount >= limits.monthly_ai_limit) {
    const err = new Error(`Monthly AI limit reached (${monthCount}/${limits.monthly_ai_limit}). Adjust border in Settings to continue.`);
    err.code = 'MONTHLY_LIMIT_EXCEEDED';
    err.month_count = monthCount;
    err.monthly_limit = limits.monthly_ai_limit;
    throw err;
  }

  return { today_count: todayCount, daily_limit: limits.daily_ai_limit, month_count: monthCount, monthly_limit: limits.monthly_ai_limit };
}

async function logApiUsage(env, provider, model, endpoint) {
  try {
    const id = `use_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      `INSERT INTO api_usage_logs (id, provider, model, endpoint) VALUES (?, ?, ?, ?)`
    ).bind(id, provider || 'unknown', model || 'unknown', endpoint || 'chat').run();
  } catch {}
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Public/MacroDroid Hardware Status Endpoint
    if (path === '/status' && method === 'GET') {
      const statusPayload = await getHardwareStatus(env);
      return jsonResponse(statusPayload);
    }

    // Verify Authentication for API routes
    if (path.startsWith('/api/')) {
      const auth = await verifyAuth(request, env);
      if (!auth.authorized) {
        return jsonResponse({ error: 'Unauthorized. Check your Bearer token or Master Password in Settings.' }, 401);
      }
    }

    try {
            // 1b. AI Credit Protection & Usage Stats Endpoint
      if (path === '/api/usage' && method === 'GET') {
        const usage = await checkApiUsageLimits(env, 'status').catch(e => e);
        return jsonResponse(usage);
      }

      // 1. Dynamic State Summary
      if (path === '/api/state' && method === 'GET') {
        const state = await buildCompactState(env);
        return jsonResponse(state);
      }

      // 2. Chat & History Endpoints (Ari & Jade)
      if (path === '/api/chat/history' && method === 'GET') {
        const sessionId = url.searchParams.get('session_id');
        const agent = url.searchParams.get('agent');
        let query = `SELECT id, session_id, agent, sender, message_text, created_at FROM chat_messages`;
        const params = [];
        const clauses = [];
        if (sessionId) {
          clauses.push(`session_id = ?`);
          params.push(sessionId);
        }
        if (agent) {
          clauses.push(`agent = ?`);
          params.push(agent);
        }
        if (clauses.length > 0) {
          query += ` WHERE ` + clauses.join(' AND ');
        }
        query += ` ORDER BY created_at ASC LIMIT 200`;
        const rows = await env.DB.prepare(query).bind(...params).all();
        return jsonResponse({ messages: rows.results || [] });
      }

            if (path === '/api/chat' && method === 'POST') {
        // Enforce user-defined borders before calling external AI APIs
        try {
          await checkApiUsageLimits(env, 'chat');
        } catch (limitErr) {
          return jsonResponse({
            error: limitErr.message,
            intercept_code: limitErr.code,
            today_count: limitErr.today_count,
            daily_limit: limitErr.daily_limit,
            month_count: limitErr.month_count,
            monthly_limit: limitErr.monthly_limit
          }, 429);
        }

        const body = await request.json();
        const sessionId = body.session_id || 'default_session';
        const agent = body.agent === 'jade' ? 'jade' : 'ari';
        const messageText = String(body.message_text || '').trim();
        const overrideProvider = body.override_provider || null;

        if (!messageText) {
          return jsonResponse({ error: 'Message text is required.' }, 400);
        }

        const userMsgId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO chat_messages (id, session_id, agent, sender, message_text) VALUES (?, ?, ?, 'user', ?)`
        ).bind(userMsgId, sessionId, agent, messageText).run();

        try {
          const aiRes = await runAgentChat(env, {
            sessionId,
            agent,
            userMessage: messageText,
            overrideProvider
          });

          const assistantMsgId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO chat_messages (id, session_id, agent, sender, message_text) VALUES (?, ?, ?, 'assistant', ?)`
          ).bind(assistantMsgId, sessionId, agent, aiRes.reply).run();

          await logApiUsage(env, aiRes.provider, aiRes.modelUsed, 'chat');


          return jsonResponse({
            reply: aiRes.reply,
            agent,
            provider: aiRes.provider,
            model_used: aiRes.modelUsed,
            session_id: sessionId
          });
        } catch (err) {
          if (err.code === 'PROVIDER_POOL_EXHAUSTED') {
            return jsonResponse({
              error: 'Provider rate limit reached across all tier models.',
              intercept_code: 'PROVIDER_POOL_EXHAUSTED',
              exhausted_provider: err.provider,
              suggested_provider: err.suggestedProvider
            }, 429);
          }
          return jsonResponse({ error: err.message || 'AI request failed.' }, 500);
        }
      }

      // 3. Tasks & Subtasks & Multimodal Proof Audits
      if (path === '/api/tasks' && method === 'GET') {
        const tasksRes = await env.DB.prepare(
          `SELECT * FROM tasks ORDER BY priority ASC, CASE WHEN due_timestamp IS NULL THEN 1 ELSE 0 END, due_timestamp ASC`
        ).all();
        const subtasksRes = await env.DB.prepare(`SELECT * FROM subtasks ORDER BY created_at ASC`).all();
        const auditsRes = await env.DB.prepare(`SELECT * FROM audit_receipts ORDER BY evaluated_at DESC`).all();
        return jsonResponse({
          tasks: tasksRes.results || [],
          subtasks: subtasksRes.results || [],
          audits: auditsRes.results || []
        });
      }

      if (path === '/api/tasks' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `t_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO tasks (
            id, title, description, priority, is_consecutive, depends_on_task_id,
            due_timestamp, estimated_duration_minutes, status, is_bonus,
            original_scheduled_date, ai_audit_criteria, requires_video
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          b.title,
          b.description || '',
          Number(b.priority) || 2,
          b.is_consecutive ? 1 : 0,
          b.depends_on_task_id || null,
          b.due_timestamp || null,
          Number(b.estimated_duration_minutes) || 45,
          b.status || 'pending',
          b.is_bonus ? 1 : 0,
          b.original_scheduled_date || null,
          b.ai_audit_criteria || null,
          b.requires_video ? 1 : 0
        ).run();
        return jsonResponse({ id, status: 'created' }, 201);
      }

      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && (method === 'PUT' || method === 'PATCH')) {
        const taskId = taskMatch[1];
        const b = await request.json();
        const existing = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
        if (!existing) return jsonResponse({ error: 'Task not found' }, 404);

        const newDue = b.due_timestamp !== undefined ? b.due_timestamp : existing.due_timestamp;
        const newStatus = b.status || existing.status;
        const completedAt = newStatus === 'completed' ? new Date().toISOString() : existing.completed_at;

        await env.DB.prepare(
          `UPDATE tasks SET
            title = ?, description = ?, priority = ?, is_consecutive = ?,
            depends_on_task_id = ?, due_timestamp = ?, estimated_duration_minutes = ?,
            status = ?, is_bonus = ?, original_scheduled_date = ?,
            ai_audit_criteria = ?, requires_video = ?, completed_at = ?
           WHERE id = ?`
        ).bind(
          b.title !== undefined ? b.title : existing.title,
          b.description !== undefined ? b.description : existing.description,
          b.priority !== undefined ? Number(b.priority) : existing.priority,
          b.is_consecutive !== undefined ? (b.is_consecutive ? 1 : 0) : existing.is_consecutive,
          b.depends_on_task_id !== undefined ? b.depends_on_task_id : existing.depends_on_task_id,
          newDue,
          b.estimated_duration_minutes !== undefined ? Number(b.estimated_duration_minutes) : existing.estimated_duration_minutes,
          newStatus,
          b.is_bonus !== undefined ? (b.is_bonus ? 1 : 0) : existing.is_bonus,
          b.original_scheduled_date !== undefined ? b.original_scheduled_date : existing.original_scheduled_date,
          b.ai_audit_criteria !== undefined ? b.ai_audit_criteria : existing.ai_audit_criteria,
          b.requires_video !== undefined ? (b.requires_video ? 1 : 0) : existing.requires_video,
          completedAt,
          taskId
        ).run();

        // Trigger consecutive cascading if due_timestamp slipped forward
        let cascaded = [];
        if (existing.due_timestamp && newDue && newDue !== existing.due_timestamp) {
          const diffMins = Math.round((Date.parse(newDue) - Date.parse(existing.due_timestamp)) / 60000);
          if (diffMins > 0) {
            cascaded = await cascadeConsecutiveTasks(env, taskId, diffMins);
          }
        }

        // Check if completing a task triggers Curry curriculum succession
        return jsonResponse({ id: taskId, status: 'updated', cascaded });
      }

      if (taskMatch && method === 'DELETE') {
        const taskId = taskMatch[1];
        await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(taskId).run();
        return jsonResponse({ id: taskId, status: 'deleted' });
      }

      // Bonus Task Pull Endpoint
      const bonusMatch = path.match(/^\/api\/tasks\/([^/]+)\/bonus$/);
      if (bonusMatch && method === 'POST') {
        const taskId = bonusMatch[1];
        const existing = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
        if (!existing) return jsonResponse({ error: 'Task not found' }, 404);

        const riyadh = getRiyadhDateParts();
        const origDate = existing.original_scheduled_date || (existing.due_timestamp ? existing.due_timestamp.slice(0, 10) : riyadh.dateStr);
        const todayDue = `${riyadh.dateStr}T21:00:00+03:00`;

        await env.DB.prepare(
          `UPDATE tasks SET is_bonus = 1, original_scheduled_date = ?, due_timestamp = ? WHERE id = ?`
        ).bind(origDate, todayDue, taskId).run();

        return jsonResponse({ id: taskId, is_bonus: true, original_scheduled_date: origDate, due_timestamp: todayDue });
      }

      // Multimodal Proof Audit Endpoint
      const auditMatch = path.match(/^\/api\/tasks\/([^/]+)\/audit$/);
      if (auditMatch && method === 'POST') {
        const taskId = auditMatch[1];
        const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
        if (!task) return jsonResponse({ error: 'Task not found' }, 404);

        const body = await request.json();
        if (!body.base64_data || !body.mime_type) {
          return jsonResponse({ error: 'Proof file (photo or PDF) is required for audit.' }, 400);
        }

        // Check usage limits before invoking external AI APIs
        try {
          await checkApiUsageLimits(env, 'proof');
        } catch (limitErr) {
          return jsonResponse({
            error: limitErr.message,
            intercept_code: limitErr.code,
            today_count: limitErr.today_count,
            daily_limit: limitErr.daily_limit,
            month_count: limitErr.month_count,
            monthly_limit: limitErr.monthly_limit
          }, 429);
        }

        // Check usage limits before invoking external AI APIs
        try {
          await checkApiUsageLimits(env, 'proof');
        } catch (limitErr) {
          return jsonResponse({
            error: limitErr.message,
            intercept_code: limitErr.code,
            today_count: limitErr.today_count,
            daily_limit: limitErr.daily_limit,
            month_count: limitErr.month_count,
            monthly_limit: limitErr.monthly_limit
          }, 429);
        }

        // Zero-Simulation Policy: fails closed if AI evaluation fails
        const evaluation = await evaluateTaskProof(env, {
          task,
          mimeType: body.mime_type,
          base64Data: body.base64_data
        });

        if (evaluation.provider && evaluation.modelUsed) {
          await logApiUsage(env, evaluation.provider, evaluation.modelUsed, 'proof');
        }

        if (evaluation.provider && evaluation.modelUsed) {
          await logApiUsage(env, evaluation.provider, evaluation.modelUsed, 'proof');
        }

        const receiptId = `aud_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO audit_receipts (id, task_id, verdict, score, critique) VALUES (?, ?, ?, ?, ?)`
        ).bind(receiptId, taskId, evaluation.verdict, evaluation.score, evaluation.critique).run();

        if (evaluation.verdict === 'passed') {
          await env.DB.prepare(
            `UPDATE tasks SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).bind(taskId).run();
        }

        return jsonResponse({
          receipt_id: receiptId,
          task_id: taskId,
          ...evaluation
        });
      }

      // Subtasks Endpoint
      if (path === '/api/subtasks' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `sub_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO subtasks (id, task_id, title, is_completed) VALUES (?, ?, ?, ?)`
        ).bind(id, b.task_id, b.title, b.is_completed ? 1 : 0).run();
        return jsonResponse({ id, status: 'created' }, 201);
      }

      const subMatch = path.match(/^\/api\/subtasks\/([^/]+)$/);
      if (subMatch && method === 'PATCH') {
        const subId = subMatch[1];
        const b = await request.json();
        await env.DB.prepare(
          `UPDATE subtasks SET is_completed = ? WHERE id = ?`
        ).bind(b.is_completed ? 1 : 0, subId).run();
        return jsonResponse({ id: subId, status: 'updated' });
      }

      // 4. Sleep & Health Endpoints
      if (path === '/api/health' && method === 'GET') {
        const riyadh = getRiyadhDateParts();
        const todayLog = await env.DB.prepare(
          `SELECT * FROM daily_health_logs WHERE date = ?`
        ).bind(riyadh.dateStr).first();
        const recentLogs = await env.DB.prepare(
          `SELECT * FROM daily_health_logs ORDER BY date DESC LIMIT 14`
        ).all();
        return jsonResponse({
          today_date: riyadh.dateStr,
          today: todayLog || null,
          history: recentLogs.results || []
        });
      }

      if (path === '/api/health' && method === 'POST') {
        const b = await request.json();
        const riyadh = getRiyadhDateParts();
        const dateKey = b.date || riyadh.dateStr;
        const existing = await env.DB.prepare(`SELECT * FROM daily_health_logs WHERE date = ?`).bind(dateKey).first();

        const sleepHours = b.sleep_hours !== undefined ? Number(b.sleep_hours) : (existing ? existing.sleep_hours : null);
        const energyScore = b.energy_score !== undefined && b.energy_score !== '' ? Number(b.energy_score) : (existing ? existing.energy_score : null);
        const isSick = b.is_sick !== undefined ? (b.is_sick ? 1 : 0) : (existing ? existing.is_sick : 0);
        const sicknessNotes = b.sickness_notes !== undefined ? b.sickness_notes : (existing ? existing.sickness_notes : '');
        const medTarget = b.medicine_target_count !== undefined ? Number(b.medicine_target_count) : (existing ? existing.medicine_target_count : 0);
        const medTaken = b.medicine_taken_count !== undefined ? Number(b.medicine_taken_count) : (existing ? existing.medicine_taken_count : 0);
        const workoutCompleted = b.workout_completed !== undefined ? (b.workout_completed ? 1 : 0) : (existing ? existing.workout_completed : 0);
        const workoutType = b.workout_type !== undefined ? b.workout_type : (existing ? existing.workout_type : '');

        await env.DB.prepare(
          `INSERT INTO daily_health_logs (
            date, sleep_hours, energy_score, is_sick, sickness_notes,
            medicine_target_count, medicine_taken_count, workout_completed, workout_type, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(date) DO UPDATE SET
            sleep_hours = excluded.sleep_hours,
            energy_score = excluded.energy_score,
            is_sick = excluded.is_sick,
            sickness_notes = excluded.sickness_notes,
            medicine_target_count = excluded.medicine_target_count,
            medicine_taken_count = excluded.medicine_taken_count,
            workout_completed = excluded.workout_completed,
            workout_type = excluded.workout_type,
            updated_at = CURRENT_TIMESTAMP`
        ).bind(
          dateKey, sleepHours, energyScore, isSick, sicknessNotes,
          medTarget, medTaken, workoutCompleted, workoutType
        ).run();

        // Sickness Protocol Circuit Breaker: freeze academic P1 chains & unlock MacroDroid
        let circuitBreakerTriggered = false;
        if (isSick === 1) {
          circuitBreakerTriggered = true;
          if (env.KV) {
            await env.KV.put('device_unlocked_override', 'true', { expirationTtl: 86400 });
          }
          // Demote non-completed P1 tasks or push their due timestamps by 24h and move intense tasks to backlog
          await env.DB.prepare(
            `UPDATE tasks SET priority = 4, due_timestamp = datetime(COALESCE(due_timestamp, CURRENT_TIMESTAMP), '+1 day')
             WHERE status IN ('pending', 'in_progress') AND priority = 1`
          ).run();
        } else if (b.is_sick === false && env.KV) {
          await env.KV.delete('device_unlocked_override');
        }

        return jsonResponse({
          date: dateKey,
          burnout_alert: sleepHours !== null && sleepHours < 4.0,
          circuit_breaker_triggered: circuitBreakerTriggered
        });
      }

      // 5. Study Locations & Flexible Pricing & Commute Friction Gate
      if (path === '/api/locations' && method === 'GET') {
        const locs = await env.DB.prepare(`SELECT * FROM study_locations ORDER BY quietness_rating DESC, commute_minutes_one_way ASC`).all();
        const items = await env.DB.prepare(`SELECT * FROM location_items ORDER BY price_sar ASC`).all();
        return jsonResponse({
          locations: locs.results || [],
          items: items.results || []
        });
      }

      if (path === '/api/locations' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `loc_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO study_locations (
            id, name, google_maps_url, service_type, quietness_rating,
            commute_minutes_one_way, average_cost_sar, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          b.name,
          b.google_maps_url || '',
          b.service_type || 'Cafe',
          Number(b.quietness_rating) || 4,
          Number(b.commute_minutes_one_way) || 15,
          b.average_cost_sar !== undefined && b.average_cost_sar !== '' && b.average_cost_sar !== null ? Number(b.average_cost_sar) : null,
          b.notes || ''
        ).run();
        return jsonResponse({ id, status: 'created' }, 201);
      }

      const locItemMatch = path.match(/^\/api\/locations\/([^/]+)\/items$/);
      if (locItemMatch && method === 'POST') {
        const locationId = locItemMatch[1];
        const b = await request.json();
        const id = b.id || `item_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO location_items (id, location_id, item_name, price_sar) VALUES (?, ?, ?, ?)`
        ).bind(id, locationId, b.item_name, Number(b.price_sar) || 0).run();
        return jsonResponse({ id, location_id: locationId, status: 'created' }, 201);
      }

      if (path === '/api/locations/commute-check' && method === 'POST') {
        const b = await request.json();
        const roundTripMinutes = (Number(b.commute_minutes_one_way) || 0) * 2;
        const plannedStudyMinutes = Number(b.planned_study_minutes) || 90;
        const ratio = roundTripMinutes / Math.max(1, plannedStudyMinutes);
        const approved = ratio <= 0.35;
        return jsonResponse({
          approved,
          round_trip_minutes: roundTripMinutes,
          planned_study_minutes: plannedStudyMinutes,
          commute_share_percent: Math.round(ratio * 100),
          verdict: approved
            ? `Approved: ${roundTripMinutes}m round-trip is ${Math.round(ratio * 100)}% of your ${plannedStudyMinutes}m focus block.`
            : `Blocked by Ari: ${roundTripMinutes}m round-trip consumes ${Math.round(ratio * 100)}% of your ${plannedStudyMinutes}m session. Stay at your desk.`
        });
      }

      // 6. Idea Vault & Friday Synthesis
      if (path === '/api/ideas' && method === 'GET') {
        const riyadh = getRiyadhDateParts();
        const activeFocus = await env.DB.prepare(
          `SELECT id FROM focus_sessions WHERE completed_at IS NULL LIMIT 1`
        ).first();
        const unlockOverride = url.searchParams.get('unlock') === 'true';
        const isVaultLocked = Boolean(activeFocus) && !unlockOverride && riyadh.weekday !== 'Fri';

        if (isVaultLocked) {
          return jsonResponse({
            vault_locked: true,
            reason: 'Active deep work session in progress. Idea Vault is in Write-Only mode.',
            ideas: []
          });
        }

        const ideas = await env.DB.prepare(`SELECT * FROM idea_vault ORDER BY created_at DESC`).all();
        return jsonResponse({
          vault_locked: false,
          ideas: ideas.results || []
        });
      }

      if (path === '/api/ideas' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `idea_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO idea_vault (id, content, domain_tag, is_locked, is_synthesized) VALUES (?, ?, ?, 1, 0)`
        ).bind(id, b.content, b.domain_tag || 'general').run();
        return jsonResponse({ id, status: 'sealed' }, 201);
      }

      if (path === '/api/ideas/synthesize' && method === 'POST') {
        const rows = await env.DB.prepare(
          `SELECT * FROM idea_vault ORDER BY created_at ASC`
        ).all();
        const ideas = rows.results || [];
        const markdown = await synthesizeIdeasMarkdown(env, ideas);
        await env.DB.prepare(`UPDATE idea_vault SET is_synthesized = 1, is_locked = 0`).run();
        return jsonResponse({ markdown, count: ideas.length });
      }

      // 7. Curry Curriculum Engine
      if (path === '/api/curriculum' && method === 'GET') {
        const units = await env.DB.prepare(
          `SELECT * FROM curriculum_units ORDER BY is_main_objective DESC, exam_name ASC, unit_number ASC`
        ).all();
        return jsonResponse({ units: units.results || [] });
      }

      if (path === '/api/curriculum' && method === 'POST') {
        const b = await request.json();
        const units = Array.isArray(b.units) ? b.units : [b];
        const inserted = [];
        for (const u of units) {
          const id = u.id || `cur_${crypto.randomUUID().slice(0, 8)}`;
          await env.DB.prepare(
            `INSERT INTO curriculum_units (
              id, exam_name, unit_number, topic_title, difficulty_level,
              estimated_hours, is_main_objective, status, target_completion_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            id,
            u.exam_name,
            Number(u.unit_number) || 1,
            u.topic_title,
            Math.max(1, Math.min(5, Number(u.difficulty_level) || 3)),
            Number(u.estimated_hours) || 2.0,
            u.is_main_objective ? 1 : 0,
            u.status || 'not_started',
            u.target_completion_date || null
          ).run();
          inserted.push(id);
        }
        return jsonResponse({ inserted, count: inserted.length }, 201);
      }

      const curMatch = path.match(/^\/api\/curriculum\/([^/]+)$/);
      if (curMatch && (method === 'PATCH' || method === 'PUT')) {
        const unitId = curMatch[1];
        const b = await request.json();
        const existing = await env.DB.prepare(`SELECT * FROM curriculum_units WHERE id = ?`).bind(unitId).first();
        if (!existing) return jsonResponse({ error: 'Unit not found' }, 404);

        const newStatus = b.status || existing.status;
        const completedAt = newStatus === 'completed' ? new Date().toISOString() : existing.completed_at;
        const isMain = b.is_main_objective !== undefined ? (b.is_main_objective ? 1 : 0) : existing.is_main_objective;

        await env.DB.prepare(
          `UPDATE curriculum_units SET status = ?, is_main_objective = ?, difficulty_level = ?, estimated_hours = ?, target_completion_date = ?, completed_at = ? WHERE id = ?`
        ).bind(
          newStatus,
          isMain,
          b.difficulty_level !== undefined ? Number(b.difficulty_level) : existing.difficulty_level,
          b.estimated_hours !== undefined ? Number(b.estimated_hours) : existing.estimated_hours,
          b.target_completion_date !== undefined ? b.target_completion_date : existing.target_completion_date,
          completedAt,
          unitId
        ).run();

        // Succession Trigger: if a Main Objective is completed, promote the highest-priority Sub Objective
        let promotedUnit = null;
        if (existing.is_main_objective && newStatus === 'completed') {
          const nextSub = await env.DB.prepare(
            `SELECT * FROM curriculum_units WHERE status != 'completed' AND is_main_objective = 0
             ORDER BY CASE WHEN target_completion_date IS NULL THEN 1 ELSE 0 END, target_completion_date ASC, difficulty_level DESC LIMIT 1`
          ).first();
          if (nextSub) {
            await env.DB.prepare(`UPDATE curriculum_units SET is_main_objective = 1 WHERE id = ?`).bind(nextSub.id).run();
            promotedUnit = nextSub;
          }
        }

        return jsonResponse({ id: unitId, status: newStatus, promoted_unit: promotedUnit });
      }

      // 8. Diary Endpoints
      if (path === '/api/diary' && method === 'GET') {
        const rows = await env.DB.prepare(`SELECT * FROM diary_entries ORDER BY created_at DESC`).all();
        return jsonResponse({ entries: rows.results || [] });
      }

      if (path === '/api/diary' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `diary_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO diary_entries (id, entry_text, mood_tag) VALUES (?, ?, ?)`
        ).bind(id, b.entry_text, b.mood_tag || 'Grounded').run();
        return jsonResponse({ id, status: 'saved' }, 201);
      }

      // 9. Budget & Automated Bank SMS Regex Webhook
      if (path === '/api/budget' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM budget_entries ORDER BY COALESCE(transaction_timestamp, created_at) DESC LIMIT 200`
        ).all();
        return jsonResponse({ entries: rows.results || [] });
      }

      if (path === '/api/budget' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `tx_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO budget_entries (id, wallet_source, merchant, amount_sar, balance_after_sar, transaction_timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          b.wallet_source || 'Cash',
          b.merchant || 'General Expense',
          Number(b.amount_sar) || 0,
          b.balance_after_sar !== undefined && b.balance_after_sar !== '' && b.balance_after_sar !== null ? Number(b.balance_after_sar) : null,
          b.transaction_timestamp || new Date().toISOString()
        ).run();
        return jsonResponse({ id, status: 'logged' }, 201);
      }

      if (path === '/api/budget/sms' && method === 'POST') {
        const b = await request.json();
        const parsed = parseBankSms(b.sms_text || b.text || '');
        const id = `sms_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO budget_entries (id, wallet_source, merchant, amount_sar, balance_after_sar, transaction_timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          parsed.wallet_source,
          parsed.merchant,
          parsed.amount_sar,
          parsed.balance_after_sar,
          parsed.transaction_timestamp
        ).run();
        return jsonResponse({ id, parsed, status: 'parsed_zero_cost' }, 201);
      }

      // 10. Focus Sessions & Leisure Endpoints
      if (path === '/api/focus' && method === 'GET') {
        const sessions = await env.DB.prepare(
          `SELECT * FROM focus_sessions ORDER BY started_at DESC LIMIT 100`
        ).all();
        return jsonResponse({ sessions: sessions.results || [] });
      }

      if (path === '/api/focus' && method === 'POST') {
        const b = await request.json();
        const id = b.id || `foc_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO focus_sessions (id, task_id, duration_minutes, session_type, completed_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          id,
          b.task_id || null,
          Number(b.duration_minutes) || 25,
          b.session_type || 'pomodoro',
          b.completed ? new Date().toISOString() : null
        ).run();
        return jsonResponse({ id, status: 'recorded' }, 201);
      }

      // 11. NewPipe Media Audit Webhook
      if (path === '/api/audit/media' && method === 'POST') {
        const b = await request.json();
        try {
          await checkApiUsageLimits(env, 'media');
        } catch (limitErr) {
          return jsonResponse({
            allowed: false,
            device_unlocked: false,
            reason: 
          }, 429);
        }

        const verdict = await evaluateMediaRelevance(env, {
          videoTitle: b.video_title || '',
          channelName: b.channel_name || ''
        });

        if (verdict.provider && verdict.modelUsed) {
          await logApiUsage(env, verdict.provider, verdict.modelUsed, 'media');
        }
        return jsonResponse({
          allowed: verdict.allowed,
          device_unlocked: verdict.allowed,
          reason: verdict.reason
        });
      }

      // 12. Universal & Contextual Settings
      if (path === '/api/settings' && method === 'GET') {
        const rows = await env.DB.prepare(`SELECT key, value, updated_at FROM system_settings`).all();
        const settings = {};
        for (const r of (rows.results || [])) {
          settings[r.key] = r.value;
        }
        return jsonResponse({ settings });
      }

      if (path === '/api/settings' && method === 'POST') {
        const b = await request.json();
        const entries = Object.entries(b.settings || b);
        for (const [k, v] of entries) {
          await env.DB.prepare(
            `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
          ).bind(String(k), String(v ?? '')).run();
        }
        return jsonResponse({ status: 'saved', count: entries.length });
      }

      return jsonResponse({ error: `Route not found: ${method} ${path}` }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Internal Worker Error' }, 500);
    }
  },

  /**
   * 03:00 AM Asia/Riyadh Cron Engine (0 0 * * * UTC)
   * 1. Initializes/resets daily medicine counters for the new day.
   * 2. Rebalances slipped consecutive tasks forward by 24 hours.
   * 3. Safely returns untouched bonus tasks (is_bonus = 1) back to their original_scheduled_date with zero penalty.
   */
  async scheduled(event, env, ctx) {
    const riyadh = getRiyadhDateParts();

    // 1. Carry over default medicine target count to the new day with 0 taken
    const prevLog = await env.DB.prepare(
      `SELECT medicine_target_count FROM daily_health_logs ORDER BY date DESC LIMIT 1`
    ).first();
    const targetMeds = prevLog ? prevLog.medicine_target_count : 0;

    await env.DB.prepare(
      `INSERT INTO daily_health_logs (date, medicine_target_count, medicine_taken_count)
       VALUES (?, ?, 0)
       ON CONFLICT(date) DO UPDATE SET medicine_taken_count = 0`
    ).bind(riyadh.dateStr, targetMeds).run();

    // 2. Return untouched bonus tasks to their original future slots with zero penalty
    await env.DB.prepare(
      `UPDATE tasks
       SET is_bonus = 0,
           due_timestamp = CASE
             WHEN original_scheduled_date IS NOT NULL THEN original_scheduled_date || 'T18:00:00+03:00'
             ELSE datetime(COALESCE(due_timestamp, CURRENT_TIMESTAMP), '+2 days')
           END
       WHERE is_bonus = 1 AND status != 'completed'`
    ).run();

    // 3. Rebalance slipped tasks from yesterday into today's queue
    await env.DB.prepare(
      `UPDATE tasks
       SET due_timestamp = datetime(due_timestamp, '+1 day')
       WHERE status IN ('pending', 'in_progress')
         AND due_timestamp IS NOT NULL
         AND due_timestamp < ?`
    ).bind(`${riyadh.dateStr}T00:00:00+03:00`).run();
  }
};
