import express from 'express';
import cors from 'cors';
import pool from './db.js'
import dotenv from 'dotenv'

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res)=>{
    res.json({message: ' Avatar chat backend is running! '});
});

app.get('/test-db', async(req, res)=>{
    try{
        const result = await pool.query('SELECT NOW()');
        res.json({
            message: 'Database connection successful',
            timestamp: result.rows[0].now
        });
    }catch(err){
       console.error('Database test error:', err);
       res.status(500).json({ error: 'Database connection failed' });
  }
})

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to test`);
});