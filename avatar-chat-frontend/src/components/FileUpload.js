import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './FileUpload.css';

const FileUpload = ({ avatarId, onBack }) => {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [knowledgeBaseInfo, setKnowledgeBaseInfo] = useState(null);

  // Load existing files and knowledge base info
  useEffect(() => {
    loadFiles();
    loadKnowledgeBaseInfo();
  }, [avatarId]);

  const loadFiles = async () => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/files/${avatarId}`);
      setUploadedFiles(response.data);
    } catch (error) {
      console.error('Error loading files:', error);
    }
  };

  const loadKnowledgeBaseInfo = async () => {
    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/knowledge-base/${avatarId}`);
      setKnowledgeBaseInfo(response.data);
    } catch (error) {
      console.error('Error loading knowledge base info:', error);
    }
  };

  const handleFileUpload = async (files) => {
    const fileList = Array.from(files);
    
    for (const file of fileList) {
      if (!isValidFileType(file)) {
        alert(`${file.name} is not a supported file type. Please upload PDF, DOC, DOCX, TXT, or MD files.`);
        continue;
      }

      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        alert(`${file.name} is too large. Maximum file size is 50MB.`);
        continue;
      }

      await uploadSingleFile(file);
    }
  };

  const isValidFileType = (file) => {
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown'
    ];
    return allowedTypes.includes(file.type) || file.name.endsWith('.md') || file.name.endsWith('.txt');
  };

  const uploadSingleFile = async (file) => {
    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('avatar_id', avatarId);

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:3001'}/api/upload`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(progress);
          },
        }
      );

      console.log('File uploaded:', response.data);
      
      // Refresh the file list
      setTimeout(() => {
        loadFiles();
        loadKnowledgeBaseInfo();
      }, 1000);

    } catch (error) {
      console.error('Upload error:', error);
      alert(`Failed to upload ${file.name}: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'pending': return '#FF9800';
      case 'failed': return '#f44336';
      default: return '#9E9E9E';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return '✓';
      case 'pending': return '⏳';
      case 'failed': return '✗';
      default: return '?';
    }
  };

  return (
    <div className="file-upload-container">
      {onBack && (
        <button className="back-button" onClick={onBack}>
          ← Back to Video
        </button>
      )}
      
      <div className="knowledge-base-header">
        <h2>📚 Knowledge Base Management</h2>
        <div className="kb-stats">
          {knowledgeBaseInfo && (
            <>
              <span className="stat">
                📁 {knowledgeBaseInfo.total_files} files uploaded
              </span>
              <span className="stat">
                ✅ {knowledgeBaseInfo.ready_files} ready for chat
              </span>
            </>
          )}
        </div>
      </div>

      {/* Upload Area */}
      <div 
        className={`upload-area ${dragActive ? 'drag-active' : ''} ${isUploading ? 'uploading' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <div className="upload-progress">
            <div className="progress-circle">
              <span>{uploadProgress}%</span>
            </div>
            <p>Uploading and processing...</p>
          </div>
        ) : (
          <>
            <div className="upload-icon">📤</div>
            <h3>Drop files here or click to upload</h3>
            <p>Supported formats: PDF, DOC, DOCX, TXT, MD</p>
            <p>Maximum file size: 50MB</p>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.md"
              onChange={(e) => handleFileUpload(e.target.files)}
              className="file-input"
            />
            <button 
              className="upload-button"
              onClick={() => document.querySelector('.file-input').click()}
            >
              Select Files
            </button>
          </>
        )}
      </div>

      {/* File List */}
      <div className="uploaded-files">
        <h3>Uploaded Documents ({uploadedFiles.length})</h3>
        {uploadedFiles.length === 0 ? (
          <div className="no-files">
            <p>No documents uploaded yet. Upload some files to enhance the AI's knowledge!</p>
          </div>
        ) : (
          <div className="file-list">
            {uploadedFiles.map((file) => (
              <div key={file.id} className="file-item">
                <div className="file-info">
                  <div className="file-name">
                    <span className="file-icon">📄</span>
                    {file.original_name}
                  </div>
                  <div className="file-details">
                    <span className="file-size">{formatFileSize(file.file_size)}</span>
                    <span className="file-date">
                      {new Date(file.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="file-status">
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(file.upload_status) }}
                  >
                    {getStatusIcon(file.upload_status)} {file.upload_status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="upload-help">
        <h4>💡 Tips:</h4>
        <ul>
          <li>Upload company documents, manuals, FAQs, or any text-based content</li>
          <li>The AI will automatically use this knowledge to answer relevant questions</li>
          <li>Files are processed in the background - check the status above</li>
          <li>Multiple files can be uploaded at once</li>
        </ul>
      </div>
    </div>
  );
};

export default FileUpload;