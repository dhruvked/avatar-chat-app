import fs from 'fs';
import path from 'path';
import pool from './db.js';

class RAGService {
  constructor(openai) {
    this.openai = openai;
  }

  // Create or get vector store for an avatar (using Files API + Embeddings)
  async getOrCreateVectorStore(avatarId) {
    try {
      // Check if vector store already exists in database
      const existingStore = await pool.query(
        'SELECT * FROM vector_stores WHERE avatar_id = $1',
        [avatarId]
      );

      if (existingStore.rows.length > 0) {
        return existingStore.rows[0].openai_store_id;
      }

      // Create new vector store entry (we'll manage embeddings ourselves)
      const storeId = `store_${avatarId}_${Date.now()}`;
      const storeName = `kb-${avatarId}-${Date.now()}`;

      // Save to database
      await pool.query(
        `INSERT INTO vector_stores (avatar_id, openai_store_id, store_name)
         VALUES ($1, $2, $3)`,
        [avatarId, storeId, storeName]
      );

      return storeId;
    } catch (error) {
      console.error('Error creating vector store:', error);
      throw error;
    }
  }

  // Upload file to OpenAI Files API
  async uploadFileToVectorStore(filePath, avatarId, originalName) {
    try {
      console.log(`Uploading file: ${filePath}`);
      
      // Get or create vector store
      const storeId = await this.getOrCreateVectorStore(avatarId);

      // Upload file to OpenAI Files API
      const file = await this.openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: 'assistants'
      });

      console.log(`File uploaded to OpenAI with ID: ${file.id}`);

      // Update database
      await pool.query(
        `UPDATE uploaded_files 
         SET openai_file_id = $1, upload_status = 'completed'
         WHERE file_path = $2 AND avatar_id = $3`,
        [file.id, filePath, avatarId]
      );

      // Update file count in vector_stores table
      await pool.query(
        `UPDATE vector_stores 
         SET file_count = file_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE avatar_id = $1`,
        [avatarId]
      );

      console.log(`File ${originalName} successfully uploaded to OpenAI`);
      return { fileId: file.id, storeId };

    } catch (error) {
      console.error('Error uploading file to OpenAI:', error);
      
      // Update status to failed
      await pool.query(
        `UPDATE uploaded_files 
         SET upload_status = 'failed'
         WHERE file_path = $1 AND avatar_id = $2`,
        [filePath, avatarId]
      );
      
      throw error;
    }
  }

  // Chat with RAG using current stable APIs
  async chatWithRAG(message, avatarId, sessionId) {
    try {
      // Get uploaded files for this avatar
      const filesResult = await pool.query(
        'SELECT openai_file_id FROM uploaded_files WHERE avatar_id = $1 AND upload_status = $2',
        [avatarId, 'completed']
      );

      if (filesResult.rows.length === 0) {
        // No knowledge base, use regular chat
        console.log('No files found for RAG, using regular chat');
        return await this.regularChat(message);
      }

      const fileIds = filesResult.rows.map(row => row.openai_file_id);
      console.log(`Found ${fileIds.length} files, attempting RAG for: "${message}"`);

      // Create assistant with file search
      const assistant = await this.openai.beta.assistants.create({
        name: `Avatar Assistant ${avatarId}`,
        instructions: `You are a helpful AI assistant avatar. Use the uploaded files to answer questions when relevant. Be conversational and engaging. 

IMPORTANT: Only reference the uploaded files if they contain relevant information to answer the user's question. If the uploaded files don't contain relevant information, respond normally without mentioning the files or knowledge base. Do not force connections to the uploaded content if it's not relevant.`,
        model: "gpt-4o-mini",
        tools: [{ type: "file_search" }],
        tool_resources: {
          file_search: {
            vector_stores: [{
              file_ids: fileIds
            }]
          }
        }
      });

      // Create thread
      const thread = await this.openai.beta.threads.create();

      // Add message to thread
      await this.openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: message
      });

      // Run the assistant
      const run = await this.openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistant.id
      });

      // Wait for completion with timeout
      let runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout
      
      while ((runStatus.status === 'queued' || runStatus.status === 'in_progress') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
        attempts++;
      }

      if (runStatus.status === 'completed') {
        // Get the assistant's response
        const messages = await this.openai.beta.threads.messages.list(thread.id);
        const lastMessage = messages.data[0];
        
        // Extract sources if any
        const sources = this.extractSources(lastMessage);
        const usedRAG = sources.length > 0; // Only mark as RAG if sources were actually used

        console.log(`RAG response generated. Used sources: ${usedRAG}, Sources count: ${sources.length}`);

        // Clean up
        try {
          await this.openai.beta.assistants.del(assistant.id);
          await this.openai.beta.threads.del(thread.id);
        } catch (cleanupError) {
          console.log('Cleanup warning:', cleanupError.message);
        }

        return {
          message: lastMessage.content[0].text.value,
          usedRAG: usedRAG,
          sources: sources
        };
      } else {
        console.log(`Assistant run failed or timed out with status: ${runStatus.status}`);
        throw new Error(`Assistant run failed with status: ${runStatus.status}`);
      }

    } catch (error) {
      console.error('RAG chat error:', error);
      // Fallback to regular chat
      console.log('Falling back to regular chat');
      const response = await this.regularChat(message);
      return { ...response, usedRAG: false };
    }
  }

  // Regular chat without RAG
  async regularChat(message) {
    const completion = await this.openai.chat.completions.create({
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

    return {
      message: completion.choices[0].message.content,
      usedRAG: false,
      sources: []
    };
  }

  // Extract source references from assistant response
  extractSources(message) {
    const sources = [];
    
    if (message.content[0].text.annotations) {
      message.content[0].text.annotations.forEach(annotation => {
        if (annotation.type === 'file_citation') {
          sources.push({
            file_id: annotation.file_citation.file_id,
            quote: annotation.file_citation.quote || 'Referenced from uploaded document'
          });
        }
      });
    }

    return sources;
  }

  // Get uploaded files for an avatar
  async getUploadedFiles(avatarId) {
    const result = await pool.query(
      'SELECT * FROM uploaded_files WHERE avatar_id = $1 ORDER BY created_at DESC',
      [avatarId]
    );
    return result.rows;
  }

  // Get vector store info
  async getVectorStoreInfo(avatarId) {
    const result = await pool.query(
      'SELECT * FROM vector_stores WHERE avatar_id = $1',
      [avatarId]
    );
    return result.rows[0] || null;
  }
}

export default RAGService;