-- ============================================================
--  admin_migration.sql
--  Run this ONCE on your existing circle_db.
--  Adds: admin role to users, reports table, suspended flag,
--        admin_sessions for secure token-based admin auth.
-- ============================================================

USE circle_db;

-- 1. Add role + suspended columns to users
ALTER TABLE users
  ADD COLUMN role      ENUM('user','admin') NOT NULL DEFAULT 'user'  AFTER email,
  ADD COLUMN suspended TINYINT(1)           NOT NULL DEFAULT 0        AFTER role;

-- 2. Reports table — users report posts to admins
CREATE TABLE IF NOT EXISTS reports (
  id           INT       NOT NULL AUTO_INCREMENT,
  post_id      INT       NOT NULL,
  reporter_id  INT       NOT NULL,
  reason       VARCHAR(255) NOT NULL,
  status       ENUM('pending','resolved','ignored') NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT fk_report_post     FOREIGN KEY (post_id)     REFERENCES posts(id)  ON DELETE CASCADE,
  CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES users(id)  ON DELETE CASCADE
);

-- 3. Admin sessions — secure token stored server-side
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         INT          NOT NULL AUTO_INCREMENT,
  admin_id   INT          NOT NULL,
  token      VARCHAR(64)  NOT NULL UNIQUE,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP    NOT NULL,

  PRIMARY KEY (id),
  CONSTRAINT fk_session_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Create your first admin account
--    Password hash below = "admin123" (bcrypt cost 10)
--    CHANGE THIS PASSWORD immediately after first login via Settings
INSERT IGNORE INTO users (name, email, password, role)
VALUES (
  'Admin',
  'admin@circle.app',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.',
  'admin'
);
