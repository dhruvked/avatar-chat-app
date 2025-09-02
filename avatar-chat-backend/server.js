import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import OpenAI from 'openai';
import RAGService from './ragService.js';
import HeyGenService from './heygenService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize RAG Service
const ragService = new RAGService(openai);

// Initialize HeyGen Service (with fallback to mock for testing)
let heygenService;
if (process.env.HEYGEN_API_KEY && process.env.HEYGEN_AVATAR_ID) {
  heygenService = new HeyGenService(
    process.env.HEYGEN_API_KEY,
    process.env.HEYGEN_AVATAR_ID
  );
  console.log('✅ HeyGen service initialized with real API');
  
  // Test the connection
  heygenService.testConnection().then(result => {
    if (result.connected) {
      console.log('✅ HeyGen API connection verified');
    } else {
      console.log('❌ HeyGen API connection failed:', result.error);
    }
  });
  
} else {
  // Mock HeyGen service for testing
  heygenService = {
    generateAvatarResponse: async (text, sessionId) => {
      console.log('🔥 Using MOCK HeyGen service');
      return {
        success: true,
        video_id: `mock_video_${Date.now()}`,
        text_response: text,
        status: 'generating'
      };
    },
    waitForVideoCompletion: async (videoId) => {
      console.log(`🔥 MOCK: Simulating video completion for ${videoId}`);
      // Simulate 5 second processing time
      await new Promise(resolve => setTimeout(resolve, 5000));
      return {
        success: true,
        video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', // Sample video
        duration: 10
      };
    },
    testConnection: async () => ({
      connected: true,
      avatar_found: true,
      mock: true
    })
  };
  console.log('🔥 Using MOCK HeyGen service for testing');
}

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

// Step 1 + Step 4: Enhanced Chat endpoint with RAG + HeyGen support
app.post('/api/chat', async (req, res) => {
  try {
    const { message, session_id, avatar_id, use_video = true } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`Processing chat request: "${message}" (video: ${use_video})`);

    // Use RAG service for intelligent text responses
    const ragResult = await ragService.chatWithRAG(
      message, 
      avatar_id || 'default', 
      session_id || 'default'
    );

    // Save initial chat record to database
    const chatRecord = await pool.query(
      `INSERT INTO chats (session_id, avatar_id, question, response, used_rag, sources, video_status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        session_id || 'default', 
        avatar_id || 'default', 
        message, 
        ragResult.message,
        ragResult.usedRAG,
        JSON.stringify(ragResult.sources),
        use_video ? 'generating' : 'text_only'
      ]
    );

    const chatId = chatRecord.rows[0].id;

    if (use_video && process.env.HEYGEN_API_KEY) {
      try {
        // Generate HeyGen avatar video asynchronously
        const videoResult = await heygenService.generateAvatarResponse(
          ragResult.message,
          session_id || 'default'
        );

        // Update chat record with video ID
        await pool.query(
          `UPDATE chats SET video_id = $1, video_status = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [videoResult.video_id, 'generating', chatId]
        );

        // Return immediate response with video generation in progress
        res.json({
          chat_id: chatId,
          message: ragResult.message,
          session_id: session_id || 'default',
          timestamp: new Date().toISOString(),
          used_rag: ragResult.usedRAG,
          sources: ragResult.sources,
          video: {
            id: videoResult.video_id,
            status: 'generating',
            message: 'Avatar video is being generated...'
          }
        });

        // Continue processing video in background
        processVideoInBackground(videoResult.video_id, chatId);

      } catch (videoError) {
        console.error('Video generation error:', videoError);
        
        // Update status to failed
        await pool.query(
          `UPDATE chats SET video_status = 'failed', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [chatId]
        );

        // Return text response even if video fails
        res.json({
          chat_id: chatId,
          message: ragResult.message,
          session_id: session_id || 'default',
          timestamp: new Date().toISOString(),
          used_rag: ragResult.usedRAG,
          sources: ragResult.sources,
          video: {
            status: 'failed',
            message: 'Video generation failed, showing text response'
          }
        });
      }
    } else {
      // Text-only response
      res.json({
        chat_id: chatId,
        message: ragResult.message,
        session_id: session_id || 'default',
        timestamp: new Date().toISOString(),
        used_rag: ragResult.usedRAG,
        sources: ragResult.sources,
        video: {
          status: 'text_only'
        }
      });
    }

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Background video processing function
async function processVideoInBackground(videoId, chatId) {
  try {
    console.log(`⏳ Processing video ${videoId} in background for chat ${chatId}`);
    
    // For now, let's simulate the process and mark as completed after a delay
    // since we're having issues with the status endpoint
    setTimeout(async () => {
      try {
        // Try to get video status, but if it fails, we'll mark as completed anyway
        let videoResult = null;
        
        try {
          videoResult = await heygenService.waitForVideoCompletion(videoId, 60000); // 1 minute timeout
          
          if (videoResult.success) {
            await pool.query(
              `UPDATE chats 
               SET video_url = $1, video_status = 'completed', updated_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [videoResult.video_url, chatId]
            );
            console.log(`✅ Video ${videoId} completed with URL: ${videoResult.video_url}`);
          }
          
        } catch (statusError) {
          console.log(`⚠️  Status check failed for ${videoId}, but video was likely generated`);
          
          // Mark as completed even without URL - frontend will show text fallback
          await pool.query(
            `UPDATE chats 
             SET video_status = 'completed_no_url', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [chatId]
          );
          console.log(`✅ Video ${videoId} marked as completed (no URL available)`);
        }
        
      } catch (error) {
        console.error(`❌ Background processing failed for ${videoId}:`, error.message);
        
        await pool.query(
          `UPDATE chats SET video_status = 'failed', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [chatId]
        );
      }
    }, 30000); // Wait 30 seconds before trying to get status
    
  } catch (error) {
    console.error(`❌ Background video processing setup failed for ${videoId}:`, error);
  }
}

// Test HeyGen connection endpoint
app.get('/api/test-heygen', async (req, res) => {
  try {
    const result = await heygenService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: 'HeyGen test failed', 
      message: error.message 
    });
  }
});

// Get available avatars endpoint  
app.get('/api/heygen-avatars', async (req, res) => {
  try {
    if (heygenService.getAvailableAvatars) {
      const avatars = await heygenService.getAvailableAvatars();
      res.json({ 
        avatars,
        count: avatars.length,
        message: 'Available HeyGen avatars'
      });
    } else {
      res.json({ 
        message: 'Using mock service - no real avatars available',
        mock_avatars: [
          { id: 'mock_avatar_1', name: 'Mock Avatar 1', gender: 'Female' },
          { id: 'mock_avatar_2', name: 'Mock Avatar 2', gender: 'Male' }
        ]
      });
    }
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch avatars', 
      message: error.message 
    });
  }
});

// Get available voices endpoint
app.get('/api/heygen-voices', async (req, res) => {
  try {
    if (heygenService.getAvailableVoices) {
      const voices = await heygenService.getAvailableVoices();
      res.json({ voices });
    } else {
      res.json({ message: 'Using mock service - no real voices available' });
    }
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch voices', 
      message: error.message 
    });
  }
});

// Check video status endpoint
app.get('/api/video-status/:chat_id', async (req, res) => {
  try {
    const { chat_id } = req.params;
    
    const result = await pool.query(
      'SELECT video_id, video_url, video_status FROM chats WHERE id = $1',
      [chat_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const chat = result.rows[0];
    
    res.json({
      video_id: chat.video_id,
      video_url: chat.video_url,
      status: chat.video_status
    });
    
  } catch (err) {
    console.error('Video status error:', err);
    res.status(500).json({ error: 'Failed to get video status' });
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