CREATE TABLE chats (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  avatar_id VARCHAR(255) NOT NULL,
  question TEXT NOT NULL,
  response TEXT,
  device_details JSONB,
  used_rag BOOLEAN DEFAULT FALSE,
  sources JSONB,
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

-- New: Files table for uploaded knowledge base documents
CREATE TABLE uploaded_files (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  openai_file_id VARCHAR(255),
  avatar_id VARCHAR(255) NOT NULL,
  upload_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- New: Vector stores table to track OpenAI vector stores
CREATE TABLE vector_stores (
  id SERIAL PRIMARY KEY,
  avatar_id VARCHAR(255) NOT NULL UNIQUE,
  openai_store_id VARCHAR(255) NOT NULL,
  store_name VARCHAR(255) NOT NULL,
  file_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX idx_uploaded_files_avatar_id ON uploaded_files(avatar_id);
CREATE INDEX idx_vector_stores_avatar_id ON vector_stores(avatar_id);