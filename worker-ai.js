/**
 * MazenOS Dual-AI Engine, Model Allocation Waterfall, Dynamic State Injection & Multimodal Audits
 */

const MODEL_POOLS = {
  gemini: {
    light: ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'],
    smart: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
  },
  claude: {
    light: ['claude-3-5-haiku-latest'],
    smart: ['claude-3-5-sonnet-latest']
  }
};

const PERSONA_PROMPTS = {
  ari: `You are Ari, the execution and scheduling operating intelligence of MazenOS.
Voice & Rules:
- Direct, disciplined, concise, analytical.
- You schedule tasks, enforce consecutive task dependencies, audit completion proofs rigorously, and refuse comfort excuses.
- Respect the user's health circuit breaker (if is_sick is true, suspend academic pressure and advise recovery).
- Evaluate commute friction before approving travel to external study locations.
- Never use filler or motivational platitudes.`,
  jade: `You are Jade, the reflective and emotional regulation companion of MazenOS.
Voice & Rules:
- Grounded, warm, perceptive, supportive.
- Provide calm perspective, cognitive reframing, emotional regulation, and weekly diary debriefs.
- Help process burnout, stress, or friction without judgment while keeping advice practical and human.`
};

/**
 * Queries D1 to construct a compact (<120 tokens) dynamic state JSON block
 */
export async function buildCompactState(env) {
  const now = new Date();
  const riyadhFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = riyadhFormatter.formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const todayStr = `${map.year}-${map.month}-${map.day}`;
  const timeNowStr = `${todayStr} ${map.hour}:${map.minute} AST`;

  // Active P1 task
  const activeP1 = await env.DB.prepare(
    `SELECT id, title, due_timestamp, is_consecutive, pomodoro_count, pomodoro_estimated FROM tasks
     WHERE status IN ('pending', 'in_progress') AND priority = 1
     ORDER BY CASE WHEN due_timestamp IS NULL THEN 1 ELSE 0 END, due_timestamp ASC LIMIT 1`
  ).first();

  // Downstream consecutive chain
  let downstreamChain = [];
  if (activeP1) {
    const depRows = await env.DB.prepare(
      `SELECT id FROM tasks WHERE depends_on_task_id = ? AND status != 'completed' LIMIT 4`
    ).bind(activeP1.id).all();
    downstreamChain = (depRows.results || []).map(r => r.id);
  }

  // Health log for today
  const healthRow = await env.DB.prepare(
    `SELECT sleep_hours, energy_score, is_sick, medicine_taken_count, medicine_target_count
     FROM daily_health_logs WHERE date = ?`
  ).bind(todayStr).first();

  // Pomodoro sessions today
  const pomodoroRow = await env.DB.prepare(
    `SELECT COUNT(*) AS sessions_count, SUM(duration_minutes) AS total_focus_mins
     FROM focus_sessions WHERE date(started_at) = ? AND completed_at IS NOT NULL`
  ).bind(todayStr).first();

  // Rest window setting
  const restSetting = await env.DB.prepare(
    `SELECT value FROM system_settings WHERE key = 'rest_window'`
  ).first();

  // Latest budget balance
  const budgetRow = await env.DB.prepare(
    `SELECT balance_after_sar FROM budget_entries
     WHERE balance_after_sar IS NOT NULL
     ORDER BY COALESCE(transaction_timestamp, created_at) DESC LIMIT 1`
  ).first();

  // Active task & curriculum counts for dashboard cards
  const taskCountRow = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM tasks WHERE status IN ('pending', 'in_progress')`
  ).first();
  const curryCountRow = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM curriculum_units`
  ).first();

  const isSick = healthRow ? Boolean(healthRow.is_sick) : false;
  const isOverdueP1 = Boolean(
    activeP1 &&
    activeP1.due_timestamp &&
    !Number.isNaN(Date.parse(activeP1.due_timestamp)) &&
    Date.now() > Date.parse(activeP1.due_timestamp)
  );
  const locked = isOverdueP1 && !isSick;

  return {
    time_now: timeNowStr,
    active_p1: activeP1 ? {
      id: activeP1.id,
      title: activeP1.title,
      due: activeP1.due_timestamp ? activeP1.due_timestamp.slice(11, 16) : null,
      is_consecutive: Boolean(activeP1.is_consecutive),
      pomodoro_spent: activeP1.pomodoro_count || 0,
      pomodoro_est: activeP1.pomodoro_estimated || 1
    } : null,
    pomodoro_metrics: {
      sessions_today: pomodoroRow ? (pomodoroRow.sessions_count || 0) : 0,
      focus_minutes_today: pomodoroRow ? (pomodoroRow.total_focus_mins || 0) : 0
    },
    downstream_chain: downstreamChain,
    health: {
      sleep_hours: healthRow ? healthRow.sleep_hours : null,
      energy: healthRow ? healthRow.energy_score : null,
      is_sick: healthRow ? Boolean(healthRow.is_sick) : false,
      meds: healthRow ? `${healthRow.medicine_taken_count || 0}/${healthRow.medicine_target_count || 0}` : '0/0'
    },
    rest_window: restSetting ? restSetting.value : '12:30 - 13:15',
    budget_balance_sar: budgetRow ? budgetRow.balance_after_sar : 0,
    active_tasks_count: taskCountRow ? (taskCountRow.cnt || 0) : 0,
    curriculum_units_count: curryCountRow ? (curryCountRow.cnt || 0) : 0,
    locked
  };
}

/**
 * Load AI configuration and API keys from system_settings
 */
export async function getAIConfig(env) {
  const rows = await env.DB.prepare(
    `SELECT key, value FROM system_settings WHERE key IN ('ai_provider', 'model_tier', 'gemini_api_key', 'claude_api_key')`
  ).all();
  const cfg = {
    ai_provider: env.DEFAULT_AI_PROVIDER || 'gemini',
    model_tier: env.DEFAULT_MODEL_TIER || 'light',
    gemini_api_key: env.GEMINI_API_KEY || '',
    claude_api_key: env.CLAUDE_API_KEY || ''
  };
  for (const r of (rows.results || [])) {
    if (r.value) cfg[r.key] = r.value;
  }
  return cfg;
}

/**
 * Call Gemini API with automatic fallback across the tier's model waterfall on HTTP 429
 */
async function callGeminiWaterfall({ apiKey, tier, systemPrompt, messages, mediaPart }) {
  if (!apiKey) {
    throw new Error('Missing Gemini API key in Settings.');
  }
  const models = MODEL_POOLS.gemini[tier] || MODEL_POOLS.gemini.light;
  let lastStatus = 500;
  let lastErrorText = '';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = messages.map(m => ({
      role: m.sender === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.message_text }]
    }));

    if (mediaPart && contents.length > 0) {
      contents[contents.length - 1].parts.push({
        inline_data: {
          mime_type: mediaPart.mimeType,
          data: mediaPart.base64Data
        }
      });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
      })
    });

    if (res.status === 429) {
      lastStatus = 429;
      lastErrorText = await res.text();
      continue; // Silent fallback to next model in pool
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini error (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return { reply, modelUsed: model, provider: 'gemini' };
  }

  if (lastStatus === 429) {
    const err = new Error('RATE_LIMIT_POOL_EXHAUSTED');
    err.code = 'PROVIDER_POOL_EXHAUSTED';
    err.provider = 'gemini';
    err.suggestedProvider = 'claude';
    err.details = lastErrorText;
    throw err;
  }
  throw new Error(`Gemini waterfall failed: ${lastErrorText}`);
}

/**
 * Call Claude API with pool support and 429 interceptor
 */
async function callClaudeWaterfall({ apiKey, tier, systemPrompt, messages, mediaPart }) {
  if (!apiKey) {
    throw new Error('Missing Claude API key in Settings.');
  }
  const models = MODEL_POOLS.claude[tier] || MODEL_POOLS.claude.light;
  let lastStatus = 500;
  let lastErrorText = '';

  for (const model of models) {
    const formattedMessages = messages.map((m, idx) => {
      const isLast = idx === messages.length - 1;
      if (isLast && mediaPart && m.sender === 'user') {
        return {
          role: 'user',
          content: [
            {
              type: mediaPart.mimeType === 'application/pdf' ? 'document' : 'image',
              source: {
                type: 'base64',
                media_type: mediaPart.mimeType,
                data: mediaPart.base64Data
              }
            },
            { type: 'text', text: m.message_text }
          ]
        };
      }
      return {
        role: m.sender === 'assistant' ? 'assistant' : 'user',
        content: m.message_text
      };
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        system: systemPrompt,
        messages: formattedMessages
      })
    });

    if (res.status === 429) {
      lastStatus = 429;
      lastErrorText = await res.text();
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Claude error (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const reply = (data?.content || []).map(c => c.text || '').join('');
    return { reply, modelUsed: model, provider: 'claude' };
  }

  if (lastStatus === 429) {
    const err = new Error('RATE_LIMIT_POOL_EXHAUSTED');
    err.code = 'PROVIDER_POOL_EXHAUSTED';
    err.provider = 'claude';
    err.suggestedProvider = 'gemini';
    err.details = lastErrorText;
    throw err;
  }
  throw new Error(`Claude waterfall failed: ${lastErrorText}`);
}

/**
 * Main chat completion entry point with <120-token dynamic state injection & 6-message history cap
 */
export async function runAgentChat(env, { sessionId, agent = 'ari', userMessage, overrideProvider }) {
  const cfg = await getAIConfig(env);
  const provider = overrideProvider || cfg.ai_provider || 'gemini';
  const tier = cfg.model_tier || 'light';

  const compactState = await buildCompactState(env);
  const personaBase = PERSONA_PROMPTS[agent] || PERSONA_PROMPTS.ari;

  // Inject longitudinal diary summary for Jade when relevant
  let jadeDiaryContext = '';
  if (agent === 'jade') {
    const recentDiaries = await env.DB.prepare(
      `SELECT mood_tag, substr(entry_text, 1, 120) AS snippet, created_at
       FROM diary_entries ORDER BY created_at DESC LIMIT 3`
    ).all();
    if (recentDiaries.results && recentDiaries.results.length > 0) {
      jadeDiaryContext = `\nRECENT_DIARY_NOTES: ${JSON.stringify(recentDiaries.results)}`;
    }
  }

  const systemPrompt = `${personaBase}\nSTATE_JSON: ${JSON.stringify(compactState)}${jadeDiaryContext}`;

  // Fetch last 5 prior messages + current user message = 6 messages max in API payload
  const historyRows = await env.DB.prepare(
    `SELECT sender, message_text FROM chat_messages
     WHERE session_id = ? AND agent = ?
     ORDER BY created_at DESC LIMIT 5`
  ).bind(sessionId, agent).all();

  const recentHistory = (historyRows.results || []).reverse();
  const payloadMessages = [
    ...recentHistory,
    { sender: 'user', message_text: userMessage }
  ].slice(-6);

  if (provider === 'claude') {
    return await callClaudeWaterfall({
      apiKey: cfg.claude_api_key,
      tier,
      systemPrompt,
      messages: payloadMessages
    });
  } else {
    return await callGeminiWaterfall({
      apiKey: cfg.gemini_api_key,
      tier,
      systemPrompt,
      messages: payloadMessages
    });
  }
}

/**
 * Multimodal Task Proof Audit (Zero-Simulation Policy: fails closed if AI call fails)
 */
export async function evaluateTaskProof(env, { task, mimeType, base64Data }) {
  const cfg = await getAIConfig(env);
  const provider = cfg.ai_provider || 'gemini';
  // Multimodal audits always use Smart tier for high accuracy
  const tier = 'smart';

  const systemPrompt = `You are Ari's Multimodal Proof Auditor.
Evaluate the uploaded proof strictly against the task requirements and audit criteria.
Return ONLY valid JSON with exact keys:
{"verdict": "passed" | "failed", "score": 1..10, "critique": "concise factual assessment"}`;

  const promptText = `Task Title: ${task.title}
Task Description: ${task.description || 'None'}
Audit Criteria: ${task.ai_audit_criteria || 'Clear visual evidence of completed work.'}
Inspect the attached proof and respond strictly with JSON.`;

  const messages = [{ sender: 'user', message_text: promptText }];
  const mediaPart = { mimeType, base64Data };

  let result;
  if (provider === 'claude') {
    result = await callClaudeWaterfall({
      apiKey: cfg.claude_api_key,
      tier,
      systemPrompt,
      messages,
      mediaPart
    });
  } else {
    result = await callGeminiWaterfall({
      apiKey: cfg.gemini_api_key,
      tier,
      systemPrompt,
      messages,
      mediaPart
    });
  }

  const cleaned = result.reply.replace(/```json|```/gi, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Zero-Simulation Policy: fail closed if response is malformed
    throw new Error('Audit response did not match strict verification format. Audit failed closed.');
  }

  const verdict = parsed.verdict === 'passed' ? 'passed' : 'failed';
  const score = Math.max(1, Math.min(10, Number(parsed.score) || (verdict === 'passed' ? 8 : 3)));
  const critique = String(parsed.critique || 'Evaluated by Ari vision auditor.');

  return { verdict, score, critique, modelUsed: result.modelUsed, provider: result.provider };
}

/**
 * NewPipe Video Title Relevance Audit (/api/audit/media)
 */
export async function evaluateMediaRelevance(env, { videoTitle, channelName }) {
  const cfg = await getAIConfig(env);
  const activeTask = await env.DB.prepare(
    `SELECT id, title, description, requires_video FROM tasks
     WHERE status IN ('in_progress', 'pending')
     ORDER BY priority ASC, due_timestamp ASC LIMIT 1`
  ).first();

  const activeUnit = await env.DB.prepare(
    `SELECT exam_name, topic_title FROM curriculum_units
     WHERE status IN ('in_progress', 'not_started')
     ORDER BY is_main_objective DESC, unit_number ASC LIMIT 1`
  ).first();

  if (!activeTask && !activeUnit) {
    return { allowed: true, reason: 'No active study block or task restriction.' };
  }

  const systemPrompt = `You are Ari's NewPipe Media Auditor. Determine whether the requested video is directly relevant to the user's active task or study curriculum unit. Return ONLY JSON: {"allowed": true|false, "reason": "short explanation"}`;
  const userText = `Video Title: "${videoTitle}" (Channel: "${channelName || 'Unknown'}")
Active Task: ${activeTask ? `${activeTask.title} (${activeTask.description || ''})` : 'None'}
Active Curriculum Unit: ${activeUnit ? `${activeUnit.exam_name} - ${activeUnit.topic_title}` : 'None'}`;

  const provider = cfg.ai_provider || 'gemini';
  const res = provider === 'claude'
    ? await callClaudeWaterfall({
        apiKey: cfg.claude_api_key,
        tier: 'light',
        systemPrompt,
        messages: [{ sender: 'user', message_text: userText }]
      })
    : await callGeminiWaterfall({
        apiKey: cfg.gemini_api_key,
        tier: 'light',
        systemPrompt,
        messages: [{ sender: 'user', message_text: userText }]
      });

  try {
    const parsed = JSON.parse(res.reply.replace(/```json|```/gi, '').trim());
    return {
      allowed: Boolean(parsed.allowed),
      reason: String(parsed.reason || 'Evaluated against active study unit.'),
      provider: res.provider,
      modelUsed: res.modelUsed
    };
  } catch {
    return { allowed: false, reason: 'Media audit could not verify study relevance (fail-closed).' };
  }
}

/**
 * Friday Idea Vault Synthesis
 */
export async function synthesizeIdeasMarkdown(env, ideas) {
  const cfg = await getAIConfig(env);
  const provider = cfg.ai_provider || 'gemini';
  const systemPrompt = `You are Ari synthesizing the user's weekly Idea Vault during Friday leisure.
Group raw ideas by domain tag, highlight actionable themes, and produce clean, structured Markdown.`;
  const rawList = ideas.map((item, i) => `${i + 1}. [${item.domain_tag}] (${item.created_at}): ${item.content}`).join('\n');

  try {
    const res = provider === 'claude'
      ? await callClaudeWaterfall({
          apiKey: cfg.claude_api_key,
          tier: 'light',
          systemPrompt,
          messages: [{ sender: 'user', message_text: `Synthesize these captured ideas into a structured Markdown report:\n${rawList}` }]
        })
      : await callGeminiWaterfall({
          apiKey: cfg.gemini_api_key,
          tier: 'light',
          systemPrompt,
          messages: [{ sender: 'user', message_text: `Synthesize these captured ideas into a structured Markdown report:\n${rawList}` }]
        });
    return res.reply;
  } catch {
    // Deterministic structured Markdown compilation if no API key is configured yet
    const byTag = {};
    for (const item of ideas) {
      const tag = item.domain_tag || 'general';
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(item);
    }
    let md = `# Friday Idea Vault Synthesis\n\n`;
    for (const [tag, list] of Object.entries(byTag)) {
      md += `## ${tag.toUpperCase()}\n`;
      for (const entry of list) {
        md += `- ${entry.content} _(${entry.created_at})_\n`;
      }
      md += `\n`;
    }
    return md;
  }
}
