import React, { useState } from 'react';
import VideoScreen from './components/VideoScreen';
import ChatScreen from './components/ChatScreen';
import './App.css';

function App() {
  const [currentScreen, setCurrentScreen] = useState('video'); // 'video' or 'chat'
  const [sessionId, setSessionId] = useState(null);

  const handleStartChat = () => {
    // Generate a new session ID each time we enter chat screen
    const newSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    setSessionId(newSessionId);
    setCurrentScreen('chat');
  };

  const handleReturnToVideo = () => {
    setCurrentScreen('video');
    setSessionId(null);
  };

  return (
    <div className="App">
      {currentScreen === 'video' && (
        <VideoScreen onStartChat={handleStartChat} />
      )}
      {currentScreen === 'chat' && (
        <ChatScreen 
          sessionId={sessionId}
          onReturnToVideo={handleReturnToVideo}
        />
      )}
    </div>
  );
}

export default App;