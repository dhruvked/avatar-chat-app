import React from 'react';
import './VideoScreen.css';

const VideoScreen = ({ onStartChat, onGoToAdmin }) => {
  return (
    <div className="video-screen">
      {/* Admin button */}
      <button 
        className="admin-button"
        onClick={onGoToAdmin}
        title="Manage Knowledge Base"
      >
        ⚙️ Admin
      </button>

      {/* Video Background */}
      <div className="video-container">
        <video
          className="background-video"
          autoPlay
          loop
          muted
          playsInline
        >
          {/* You'll replace this with your actual video */}
          <source src="/api/placeholder-video.mp4" type="video/mp4" />
          {/* Fallback for browsers that don't support video */}
          <div className="video-placeholder">
            <div className="avatar-placeholder">
              <h2>🎭 Celebrity Avatar</h2>
              <p>Interactive AI Avatar</p>
            </div>
          </div>
        </video>
        
        {/* Overlay content */}
        <div className="video-overlay">
          <div className="content">
            <h1>Meet Celebrity X</h1>
            <p>Chat with our AI-powered celebrity avatar</p>
            <button 
              className="talk-button"
              onClick={onStartChat}
            >
              Talk to Celebrity X
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoScreen;