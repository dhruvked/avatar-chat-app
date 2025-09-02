import axios from 'axios';

class HeyGenService {
  constructor(apiKey, avatarId) {
    this.apiKey = apiKey;
    this.avatarId = avatarId;
    this.baseURL = 'https://api.heygen.com/v2';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json'
      }
    });
  }

  // Test API connectivity using the correct v2 endpoints
  async testConnection() {
    try {
      console.log('🔍 Testing HeyGen API v2 connection...');
      
      // Use the correct v2 avatar list endpoint
      const avatarsResponse = await this.client.get('/avatars');
      console.log('✅ HeyGen API v2 connection successful');
      
      // Handle different possible response structures
      let avatars = [];
      if (avatarsResponse.data.data && Array.isArray(avatarsResponse.data.data)) {
        avatars = avatarsResponse.data.data;
      } else if (avatarsResponse.data.data && avatarsResponse.data.data.avatars && Array.isArray(avatarsResponse.data.data.avatars)) {
        avatars = avatarsResponse.data.data.avatars;
      } else if (Array.isArray(avatarsResponse.data)) {
        avatars = avatarsResponse.data;
      } else if (avatarsResponse.data.avatars && Array.isArray(avatarsResponse.data.avatars)) {
        avatars = avatarsResponse.data.avatars;
      } else {
        console.log('⚠️  Unexpected response structure, cannot parse avatars');
        return {
          connected: true,
          avatar_found: false,
          total_avatars: 0,
          raw_response: avatarsResponse.data,
          error: 'Unexpected response structure - please check raw_response'
        };
      }
      
      console.log(`Found ${avatars.length} available avatars`);
      
      // Check if our avatar ID exists
      let ourAvatar = null;
      let availableAvatarIds = [];
      
      if (avatars.length > 0) {
        ourAvatar = avatars.find(avatar => 
          avatar.avatar_id === this.avatarId || 
          avatar.id === this.avatarId ||
          avatar.avatarId === this.avatarId
        );
        
        // Get available avatar IDs (handle different property names) - only first 10 for logs
        availableAvatarIds = avatars.slice(0, 10).map(a => ({
          id: a.avatar_id || a.id || a.avatarId,
          name: a.avatar_name || a.name || a.avatarName || 'Unknown',
          gender: a.gender || 'Unknown'
        }));
      }
      
      if (ourAvatar) {
        console.log('✅ Avatar found:', ourAvatar.avatar_name || ourAvatar.name || this.avatarId);
      } else {
        console.log('⚠️  Avatar not found:', this.avatarId);
        console.log('First 3 available avatars:', availableAvatarIds.slice(0, 3));
      }
      
      return {
        connected: true,
        avatar_found: !!ourAvatar,
        total_avatars: avatars.length,
        available_avatars: availableAvatarIds, // Still return full list for API endpoint
        current_avatar_id: this.avatarId,
        raw_response_keys: Object.keys(avatarsResponse.data)
      };
      
    } catch (error) {
      console.error('❌ HeyGen API v2 connection failed:', error.response?.data || error.message);
      return {
        connected: false,
        error: error.message,
        status: error.response?.status,
        response_data: error.response?.data
      };
    }
  }

  // Generate avatar video using v2 API structure
  async generateAvatarVideo(text, sessionId) {
    try {
      console.log(`🎬 Generating HeyGen video for session ${sessionId}`);
      
      // v2 API request structure based on documentation
      const requestData = {
        video_inputs: [
          {
            character: {
              type: "avatar",
              avatar_id: this.avatarId,
              scale: 1.0
            },
            voice: {
              type: "text",
              input_text: text,
              voice_id: "1bd001e7e50f421d891986aad5158bc8", // Default English voice
              speed: 1.0
            }
          }
        ],
        dimension: {
          width: 1280,
          height: 720
        },
        aspect_ratio: "16:9",
        test: true, // Set to false for production
        caption: false
      };
      
      const response = await this.client.post('/video/generate', requestData);
      
      // Check for success - HeyGen returns { error: null, data: { video_id: "..." } }
      if (response.data.error === null && response.data.data && response.data.data.video_id) {
        console.log('✅ HeyGen video generation started, ID:', response.data.data.video_id);
        return {
          success: true,
          video_id: response.data.data.video_id,
          message: 'Video generation started'
        };
      } else if (response.data.error) {
        throw new Error(`HeyGen API error: ${response.data.error}`);
      } else {
        throw new Error(`HeyGen API error: Missing video_id in response`);
      }

    } catch (error) {
      console.error('❌ HeyGen video generation failed:', error.response?.data || error.message);
      
      if (error.response?.status === 400) {
        console.error('   - Check request format and avatar ID');
      } else if (error.response?.status === 401) {
        console.error('   - Check API key');
      } else if (error.response?.status === 404) {
        console.error('   - Check endpoint URL');
      }
      
      throw error;
    }
  }

  // Check video generation status using v2 API
  async checkVideoStatus(videoId) {
    try {
      console.log(`🔍 Checking status for video: ${videoId}`);
      
      // Try the most likely v2 endpoints for video status
      const possibleEndpoints = [
        `/video_status/${videoId}`,
        `/video/${videoId}`,
        `/videos/${videoId}`,
        `/video/status/${videoId}`,
        `/video_generation/${videoId}`
      ];
      
      for (const endpoint of possibleEndpoints) {
        try {
          const response = await this.client.get(endpoint);
          console.log(`✅ Found working status endpoint: ${endpoint}`);
          
          const data = response.data.data || response.data;
          return {
            status: data.status,
            video_url: data.video_url,
            video_url_caption: data.video_url_caption,
            duration: data.duration,
            thumbnail_url: data.thumbnail_url,
            gif_url: data.gif_url,
            working_endpoint: endpoint // Store for future use
          };
          
        } catch (endpointError) {
          console.log(`❌ ${endpoint} failed: ${endpointError.response?.status}`);
          continue;
        }
      }
      
      throw new Error('All video status endpoints failed');

    } catch (error) {
      console.error('❌ All HeyGen status endpoints failed:', error.message);
      throw error;
    }
  }

  // Poll for video completion with timeout
  async waitForVideoCompletion(videoId, maxWaitTime = 300000) { // 5 minutes max
    const startTime = Date.now();
    const pollInterval = 5000; // Check every 5 seconds (don't overload API)

    console.log(`Waiting for video ${videoId} completion...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.checkVideoStatus(videoId);
        
        console.log(`Video ${videoId} status: ${status.status}`);

        if (status.status === 'completed') {
          console.log(`✅ Video ${videoId} completed successfully`);
          return {
            success: true,
            video_url: status.video_url,
            duration: status.duration,
            thumbnail_url: status.thumbnail_url,
            gif_url: status.gif_url
          };
        } else if (status.status === 'failed') {
          throw new Error('Video generation failed');
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error('Error polling video status:', error);
        throw error;
      }
    }

    throw new Error(`Video generation timeout after ${maxWaitTime/1000} seconds`);
  }

  // Generate avatar response (combines text generation + video creation)
  async generateAvatarResponse(text, sessionId) {
    try {
      // Start video generation
      const videoGeneration = await this.generateAvatarVideo(text, sessionId);
      
      if (!videoGeneration.success) {
        throw new Error('Failed to start video generation');
      }

      return {
        success: true,
        video_id: videoGeneration.video_id,
        text_response: text,
        status: 'generating'
      };

    } catch (error) {
      console.error('Avatar response generation error:', error);
      throw error;
    }
  }

  // Get available avatars using v2 API
  async getAvailableAvatars() {
    try {
      const response = await this.client.get('/avatars');
      
      // Handle different possible response structures
      if (response.data.data && Array.isArray(response.data.data)) {
        return response.data.data;
      } else if (response.data.data && response.data.data.avatars && Array.isArray(response.data.data.avatars)) {
        return response.data.data.avatars;
      } else if (Array.isArray(response.data)) {
        return response.data;
      } else if (response.data.avatars && Array.isArray(response.data.avatars)) {
        return response.data.avatars;
      }
      
      console.log('Unexpected avatar response structure:', response.data);
      return [];
    } catch (error) {
      console.error('Error fetching avatars:', error);
      throw error;
    }
  }

  // Get available voices using v2 API
  async getAvailableVoices() {
    try {
      const response = await this.client.get('/voices');
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching voices:', error);
      throw error;
    }
  }

  // Get avatar details
  async getAvatarDetails(avatarId = null) {
    try {
      const id = avatarId || this.avatarId;
      const response = await this.client.get(`/avatars/${id}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching avatar details:', error);
      throw error;
    }
  }
}

export default HeyGenService;