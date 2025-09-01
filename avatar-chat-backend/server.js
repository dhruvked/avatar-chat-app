import express from 'express';
import cors from 'cors';
import pool from './db.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
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

// Step 1: Basic LLM Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, session_id, avatar_id } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful AI assistant avatar. Keep responses conversational and engaging."
        },
        {
          role: "user",
          content: message
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });

    const aiResponse = completion.choices[0].message.content;

    // Save to database
    await pool.query(
      `INSERT INTO chats (session_id, avatar_id, question, response) 
       VALUES ($1, $2, $3, $4)`,
      [session_id || 'default', avatar_id || 'default', message, aiResponse]
    );

    res.json({
      message: aiResponse,
      session_id: session_id || 'default',
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to process chat message' });
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