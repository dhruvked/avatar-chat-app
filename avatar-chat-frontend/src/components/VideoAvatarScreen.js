import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './VideoAvatarScreen.css';

const VideoAvatarScreen = ({ sessionId, onReturnToVideo }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentVideoStatus, setCurrentVideoStatus] = useState(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const messagesEndRef = useRef(null);
  const videoRef = useRef(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  // Auto-return to video screen after inactivity
  useEffect(() => {
    const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    const checkInactivity = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        onReturnToVideo();
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(checkInactivity);
  }, [lastActivity, onReturnToVideo]);

  // Poll for video status updates
  const pollVideoStatus = async (chatId) => {
    const maxPolls = 60; // 3 minutes max (3 seconds * 60)
    let pollCount = 0;

    const poll = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/video-status/${chatId}`
        );

        const { status, video_url } = response.data;

        if (status === 'completed' && video_url) {
          // Update message with completed video
          setMessages(prev => prev.map(msg => 
            msg.chatId === chatId 
              ? { ...msg, video: { ...msg.video, status: 'completed', url: video_url } }
              : msg
          ));
          return true; // Stop polling
        } else if (status === 'failed') {
          // Mark video as failed
          setMessages(prev => prev.map(msg => 
            msg.chatId === chatId 
              ? { ...msg, video: { ...msg.video, status: 'failed' } }
              : msg
          ));
          return true; // Stop polling
        }

        pollCount++;
        if (pollCount < maxPolls) {
          setTimeout(poll, 3000); // Poll again in 3 seconds
        } else {
          // Timeout - mark as failed
          setMessages(prev => prev.map(msg => 
            msg.chatId === chatId 
              ? { ...msg, video: { ...msg.video, status: 'timeout' } }
              : msg
          ));
        }

      } catch (error) {
        console.error('Error polling video status:', error);
        return true; // Stop polling on error
      }
    };

    poll();
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isProcessing) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setLastActivity(Date.now());
    setIsProcessing(true);

    // Add user message to chat
    setMessages(prev => [...prev, {
      type: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    }]);

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/chat`,
        {
          message: userMessage,
          session_id: sessionId,
          avatar_id: 'celebrity_x',
          use_video: true
        }
      );

      // Add AI response with video info
      const aiMessage = {
        type: 'assistant',
        content: response.data.message,
        timestamp: response.data.timestamp,
        usedRAG: response.data.used_rag,
        sources: response.data.sources,
        chatId: response.data.chat_id,
        video: response.data.video
      };

      setMessages(prev => [...prev, aiMessage]);

      // Start polling for video completion if video is generating
      if (response.data.video && response.data.video.status === 'generating') {
        pollVideoStatus(response.data.chat_id);
      }

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        type: 'error',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderMessage = (message, index) => {
    if (message.type === 'user') {
      return (
        <div key={index} className="message user">
          <div className="message-content">
            {message.content}
          </div>
          <div className="message-time">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      );
    }

    if (message.type === 'assistant') {
      return (
        <div key={index} className="message assistant">
          <div className="message-content">
            {/* Video Response */}
            {message.video && (
              <div className="video-response">
                {message.video.status === 'generating' && (
                  <div className="video-generating">
                    <div className="avatar-thinking">🎭</div>
                    <p>Creating avatar response...</p>
                    <div className="loading-bar">
                      <div className="loading-progress"></div>
                    </div>
                  </div>
                )}
                
                {message.video.status === 'completed' && message.video.url && (
                  <div className="video-completed">
                    <video
                      ref={videoRef}
                      controls
                      autoPlay
                      className="avatar-video"
                      onEnded={() => setCurrentVideoStatus('ended')}
                    >
                      <source src={message.video.url} type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                )}
                
                {(message.video.status === 'failed' || message.video.status === 'timeout' || message.video.status === 'text_only') && (
                  <div className="video-fallback">
                    <div className="avatar-static">🎭</div>
                    <p className="fallback-text">{message.content}</p>
                  </div>
                )}
              </div>
            )}

            {/* RAG Indicator */}
            {message.usedRAG && message.sources && message.sources.length > 0 && (
              <div className="rag-indicator">
                📚 Response based on uploaded documents
              </div>
            )}
          </div>
          
          <div className="message-time">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      );
    }

    if (message.type === 'error') {
      return (
        <div key={index} className="message error">
          <div className="message-content">
            {message.content}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="video-avatar-screen">
      {/* Header */}
      <div className="chat-header">
        <button className="back-button" onClick={onReturnToVideo}>
          ← Back to Video
        </button>
        <h2>🎭 Talking with Celebrity X</h2>
        <div className="session-info">Session: {sessionId}</div>
      </div>

      {/* Main Avatar Area */}
      <div className="avatar-main-area">
        <div className={`avatar-container ${isProcessing ? 'thinking' : 'ready'}`}>
          <div className="avatar-display">
            {!isProcessing ? (
              <div className="avatar-idle">
                <div className="avatar-face">🎭</div>
                <p>Ready to chat</p>
              </div>
            ) : (
              <div className="avatar-processing">
                <div className="avatar-face thinking">🤔</div>
                <p>Thinking...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="messages-container">
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome-message">
              <p>👋 Hi! I'm Celebrity X. Ask me anything and I'll respond with a personalized video!</p>
            </div>
          )}
          
          {messages.map((message, index) => renderMessage(message, index))}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Section */}
      <div className="input-section">
        <form onSubmit={sendMessage} className="message-form">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask me anything..."
            className="message-input"
            disabled={isProcessing}
          />
          <button 
            type="submit" 
            className="send-button"
            disabled={isProcessing || !inputMessage.trim()}
          >
            {isProcessing ? 'Processing...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default VideoAvatarScreen;