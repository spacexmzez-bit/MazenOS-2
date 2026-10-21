-- MazenOS Unified Relational Schema

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent TEXT NOT NULL CHECK (agent IN ('ari', 'jade')),
    sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant')),
    message_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    project_id TEXT NOT NULL DEFAULT 'inbox',
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4) DEFAULT 2,
    is_consecutive BOOLEAN NOT NULL DEFAULT 0,
    depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    due_timestamp DATETIME,
    estimated_duration_minutes INTEGER NOT NULL DEFAULT 45,
    pomodoro_estimated INTEGER NOT NULL DEFAULT 1,
    pomodoro_count INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    recurrence_rule TEXT DEFAULT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'archived', 'trash')) DEFAULT 'pending',
    is_bonus BOOLEAN NOT NULL DEFAULT 0,
    original_scheduled_date DATE,
    ai_audit_criteria TEXT,
    exemplar_data TEXT DEFAULT NULL,
    requires_video BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_timestamp);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_receipts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL CHECK (verdict IN ('passed', 'failed')),
    score INTEGER CHECK (score BETWEEN 1 AND 10),
    critique TEXT NOT NULL,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_health_logs (
    date DATE PRIMARY KEY,
    sleep_hours REAL,
    energy_score INTEGER CHECK (energy_score BETWEEN 0 AND 100),
    is_sick BOOLEAN NOT NULL DEFAULT 0,
    sickness_notes TEXT,
    medicine_target_count INTEGER NOT NULL DEFAULT 0,
    medicine_taken_count INTEGER NOT NULL DEFAULT 0,
    workout_completed BOOLEAN NOT NULL DEFAULT 0,
    workout_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS study_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    google_maps_url TEXT,
    service_type TEXT,
    quietness_rating INTEGER CHECK (quietness_rating BETWEEN 1 AND 5),
    commute_minutes_one_way INTEGER NOT NULL,
    average_cost_sar REAL DEFAULT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location_items (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL REFERENCES study_locations(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    price_sar REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idea_vault (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    domain_tag TEXT DEFAULT 'general',
    is_locked BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_synthesized BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS curriculum_units (
    id TEXT PRIMARY KEY,
    exam_name TEXT NOT NULL,
    unit_number INTEGER NOT NULL,
    topic_title TEXT NOT NULL,
    difficulty_level INTEGER CHECK (difficulty_level BETWEEN 1 AND 5) NOT NULL DEFAULT 3,
    estimated_hours REAL NOT NULL DEFAULT 2.0,
    is_main_objective BOOLEAN NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed')) DEFAULT 'not_started',
    target_completion_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS budget_entries (
    id TEXT PRIMARY KEY,
    wallet_source TEXT NOT NULL,
    merchant TEXT,
    amount_sar REAL NOT NULL,
    balance_after_sar REAL,
    transaction_timestamp DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS diary_entries (
    id TEXT PRIMARY KEY,
    entry_text TEXT NOT NULL,
    mood_tag TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 25,
    session_type TEXT NOT NULL CHECK (session_type IN ('pomodoro', 'break', 'deep_work')) DEFAULT 'pomodoro',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS api_usage_logs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage_logs(created_at);
