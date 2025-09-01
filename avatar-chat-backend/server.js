import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import OpenAI from 'openai';
import RAGService from './ragService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize RAG Service
const ragService = new RAGService(openai);

const app = express();
const PORT = process.env.PORT || 3001;

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload PDF, DOC, DOCX, TXT, or MD files.'));
    }
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'], // Allow React dev server
  credentials: true
}));
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Avatar Chat Backend is running!' });
});

// Test database connection route
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      message: 'Database connection successful', 
      timestamp: result.rows[0].now 
    });
  } catch (err) {
    console.error('Database test error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Step 1 + Step 4: Enhanced Chat endpoint with RAG support
app.post('/api/chat', async (req, res) => {
  try {
    const { message, session_id, avatar_id } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Use RAG service for intelligent responses
    const result = await ragService.chatWithRAG(
      message, 
      avatar_id || 'default', 
      session_id || 'default'
    );

    // Save to database with RAG information
    await pool.query(
      `INSERT INTO chats (session_id, avatar_id, question, response, used_rag, sources) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session_id || 'default', 
        avatar_id || 'default', 
        message, 
        result.message,
        result.usedRAG,
        JSON.stringify(result.sources)
      ]
    );

    res.json({
      message: result.message,
      session_id: session_id || 'default',
      timestamp: new Date().toISOString(),
      used_rag: result.usedRAG,
      sources: result.sources
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { avatar_id } = req.body;
    const avatarId = avatar_id || 'default';

    // Save file info to database
    const fileRecord = await pool.query(
      `INSERT INTO uploaded_files (filename, original_name, file_path, file_size, mime_type, avatar_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.file.filename,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        avatarId
      ]
    );

    // Upload to OpenAI vector store asynchronously
    ragService.uploadFileToVectorStore(req.file.path, avatarId, req.file.originalname)
      .then(() => {
        console.log(`File ${req.file.originalname} successfully processed`);
      })
      .catch((error) => {
        console.error(`Failed to process file ${req.file.originalname}:`, error);
      });

    res.json({
      message: 'File uploaded successfully and is being processed',
      file: fileRecord.rows[0]
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get uploaded files for an avatar
app.get('/api/files/:avatar_id', async (req, res) => {
  try {
    const { avatar_id } = req.params;
    const files = await ragService.getUploadedFiles(avatar_id);
    
    res.json(files);
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// Get knowledge base info for an avatar
app.get('/api/knowledge-base/:avatar_id', async (req, res) => {
  try {
    const { avatar_id } = req.params;
    const vectorStore = await ragService.getVectorStoreInfo(avatar_id);
    const files = await ragService.getUploadedFiles(avatar_id);
    
    res.json({
      vector_store: vectorStore,
      files: files,
      total_files: files.length,
      ready_files: files.filter(f => f.upload_status === 'completed').length
    });
  } catch (err) {
    console.error('Error fetching knowledge base info:', err);
    res.status(500).json({ error: 'Failed to fetch knowledge base info' });
  }
});

// Chat routes (we'll add these next)
app.get('/api/chats', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM chats ORDER BY created_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.post('/api/chats', async (req, res) => {
  try {
    const { session_id, avatar_id, question, response, device_details } = req.body;
    
    const result = await pool.query(
      `INSERT INTO chats (session_id, avatar_id, question, response, device_details) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [session_id, avatar_id, question, response, device_details]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error saving chat:', err);
    res.status(500).json({ error: 'Failed to save chat' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to test`);
});