-- タイピング練習アプリ データベース定義（タイピング.db と同じ構成）
-- 再構築（リポジトリのルートで）: sqlite3 新しいファイル名.db < db/schema.sql
-- 注意: 既存の タイピング.db に対して実行すると「already exists」で失敗する

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id   TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE levels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  title       TEXT NOT NULL,
  description TEXT,
  prompt      TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  pass_accuracy REAL CHECK (pass_accuracy IS NULL OR (pass_accuracy > 0 AND pass_accuracy <= 1)),
  FOREIGN KEY (stage_id) REFERENCES stages(id)
);

CREATE TABLE keyboards (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  layout    TEXT NOT NULL DEFAULT 'jis' CHECK (layout IN ('jis', 'us', 'keyball44', 'free')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  keyboard_id INTEGER NOT NULL,
  char        TEXT NOT NULL,
  finger      TEXT NOT NULL,
  FOREIGN KEY (keyboard_id) REFERENCES keyboards(id)
);

CREATE TABLE logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  level_id     INTEGER NOT NULL,
  keyboard_id  INTEGER,
  question_num INTEGER NOT NULL,
  target       TEXT NOT NULL,
  typed        TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (level_id) REFERENCES levels(id),
  FOREIGN KEY (keyboard_id) REFERENCES keyboards(id)
);

-- 検索を速くするための索引
CREATE TABLE assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  level_id      INTEGER NOT NULL,
  due_at        TEXT NOT NULL,
  required_plays INTEGER NOT NULL DEFAULT 1 CHECK (required_plays >= 1),
  min_accuracy  REAL CHECK (min_accuracy IS NULL OR (min_accuracy > 0 AND min_accuracy <= 1)),
  created_at    TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (level_id) REFERENCES levels(id)
);

CREATE INDEX idx_stages_is_active ON stages(is_active);
CREATE INDEX idx_levels_stage_id ON levels(stage_id);
CREATE INDEX idx_levels_is_active ON levels(is_active);
CREATE INDEX idx_keyboards_user_id ON keyboards(user_id);
CREATE INDEX idx_keyboards_is_active ON keyboards(is_active);
CREATE INDEX idx_keys_keyboard_id ON keys(keyboard_id);
CREATE INDEX idx_logs_session_id ON logs(session_id);
CREATE INDEX idx_logs_user_id ON logs(user_id);
CREATE INDEX idx_logs_level_id ON logs(level_id);
CREATE INDEX idx_logs_keyboard_id ON logs(keyboard_id);
CREATE INDEX idx_assignments_level_id ON assignments(level_id);
CREATE INDEX idx_assignments_is_active ON assignments(is_active);

-- logs は追加のみ（上書き・削除を禁止）
CREATE TRIGGER logs_no_update BEFORE UPDATE ON logs
BEGIN
  SELECT RAISE(ABORT, 'logs は追加のみです（上書きはできません）');
END;

CREATE TRIGGER logs_no_delete BEFORE DELETE ON logs
BEGIN
  SELECT RAISE(ABORT, 'logs は追加のみです（削除はできません）');
END;
