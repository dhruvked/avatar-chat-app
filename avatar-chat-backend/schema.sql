CREATE TABLE chats (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  avatar_id VARCHAR(255) NOT NULL,
  question TEXT NOT NULL,
  response TEXT,
  device_details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX idx_chats_session_id ON chats(session_id);
CREATE INDEX idx_chats_avatar_id ON chats(avatar_id);
CREATE INDEX idx_chats_created_at ON chats(created_at);

-- Optional: Sessions table for tracking conversation sessions
CREATE TABLE sessions (
  id VARCHAR(255) PRIMARY KEY,
  avatar_id VARCHAR(255) NOT NULL,
  device_details JSONB,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);
