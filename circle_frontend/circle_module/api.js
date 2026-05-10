// Circle App - API Service

import { API_BASE_URL } from './constants.js';
import { getFingerprint } from './utils.js';

/**
 * Make an API request
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @param {string} path - API endpoint path (without /api prefix)
 * @param {object|null} body - Request body (will be JSON stringified)
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<any>} Response data
 */
export async function api(method, path, body = null, signal = undefined) {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : '/' + path}`;
  
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
  };
  
  // Add auth token if available
  const token = localStorage.getItem('circle_token');
  if (token) {
    opts.headers.Authorization = `Bearer ${token}`;
  }
  
  // Add fingerprint for guest tracking
  const fp = getFingerprint();
  if (fp) {
    opts.headers['X-Fingerprint'] = fp;
  }
  
  // Add body for methods that support it
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    opts.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, opts);
    
    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || 5;
      throw new Error(`Rate limited. Please wait ${retryAfter} seconds.`);
    }
    
    // Parse response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Request failed');
      }
      
      return data;
    }
    
    // Non-JSON response
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      // Request was cancelled, don't throw
      return null;
    }
    throw error;
  }
}

/**
 * GET request helper
 */
export async function get(path, params = null, signal = undefined) {
  let url = path;
  if (params) {
    const queryString = new URLSearchParams(params).toString();
    url = `${path}${path.includes('?') ? '&' : '?'}${queryString}`;
  }
  return api('GET', url, null, signal);
}

/**
 * POST request helper
 */
export async function post(path, body = null, signal = undefined) {
  return api('POST', path, body, signal);
}

/**
 * PUT request helper
 */
export async function put(path, body = null, signal = undefined) {
  return api('PUT', path, body, signal);
}

/**
 * PATCH request helper
 */
export async function patch(path, body = null, signal = undefined) {
  return api('PATCH', path, body, signal);
}

/**
 * DELETE request helper
 */
export async function del(path, signal = undefined) {
  return api('DELETE', path, null, signal);
}

// ==================== Auth API ====================

export const auth = {
  /**
   * Register a new user
   */
  register(name, email, password) {
    return post('/auth/register', { name, email, password });
  },
  
  /**
   * Login with email/password
   */
  login(email, password) {
    return post('/auth/login', { email, password });
  },
  
  /**
   * Login with phone/OTP (step 1: send OTP)
   */
  sendPhoneOtp(dialCode, phone) {
    return post('/auth/phone/send-otp', { dialCode, phone });
  },
  
  /**
   * Login with phone/OTP (step 2: verify OTP)
   */
  verifyPhoneOtp(dialCode, phone, otp) {
    return post('/auth/phone/verify-otp', { dialCode, phone, otp });
  },
  
  /**
   * Logout
   */
  logout() {
    return post('/auth/logout');
  },
  
  /**
   * Request password reset
   */
  requestPasswordReset(email) {
    return post('/auth/reset-password', { email });
  },
  
  /**
   * Reset password with token
   */
  resetPassword(token, newPassword) {
    return post('/auth/reset-password/confirm', { token, password: newPassword });
  },
  
  /**
   * Get current user data
   */
  me() {
    return get('/auth/me');
  },
};

// ==================== Posts API ====================

export const posts = {
  /**
   * Get feed posts
   */
  getFeed(tab = 'for-you', page = 1, limit = 15) {
    return get('/posts/feed', { tab, page, limit });
  },
  
  /**
   * Get a single post by ID
   */
  getPost(id) {
    return get(`/posts/${id}`);
  },
  
  /**
   * Create a new post
   */
  createPost(text, mediaUrl = null, mediaType = null) {
    return post('/posts', { text, mediaUrl, mediaType });
  },
  
  /**
   * Update a post
   */
  updatePost(id, text) {
    return patch(`/posts/${id}`, { text });
  },
  
  /**
   * Delete a post
   */
  deletePost(id) {
    return del(`/posts/${id}`);
  },
  
  /**
   * Like a post
   */
  like(id) {
    return post(`/posts/${id}/like`);
  },
  
  /**
   * Unlike a post
   */
  unlike(id) {
    return del(`/posts/${id}/like`);
  },
  
  /**
   * Repost
   */
  repost(id, quoteText = null) {
    return post(`/posts/${id}/repost`, { quoteText });
  },
  
  /**
   * Undo repost
   */
  undoRepost(id) {
    return del(`/posts/${id}/repost`);
  },
  
  /**
   * Add a comment
   */
  addComment(postId, text, parentId = null) {
    return post(`/posts/${postId}/comments`, { text, parentId });
  },
  
  /**
   * Get comments for a post
   */
  getComments(postId, page = 1, limit = 20) {
    return get(`/posts/${postId}/comments`, { page, limit });
  },
  
  /**
   * Delete a comment
   */
  deleteComment(postId, commentId) {
    return del(`/posts/${postId}/comments/${commentId}`);
  },
  
  /**
   * Report a post
   */
  report(id, reason, details = null) {
    return post(`/posts/${id}/report`, { reason, details });
  },
  
  /**
   * Record a view
   */
  recordView(id) {
    return post(`/posts/${id}/view`);
  },
  
  /**
   * Mark as not interested
   */
  notInterested(id) {
    return post(`/posts/${id}/not-interested`);
  },
};

// ==================== Users API ====================

export const users = {
  /**
   * Get user profile
   */
  getProfile(userId) {
    return get(`/users/${userId}`);
  },
  
  /**
   * Update user profile
   */
  updateProfile(data) {
    return patch('/users/me', data);
  },
  
  /**
   * Upload avatar
   */
  uploadAvatar(avatarUrl) {
    return patch('/users/me/avatar', { avatarUrl });
  },
  
  /**
   * Follow a user
   */
  follow(userId) {
    return post(`/users/${userId}/follow`);
  },
  
  /**
   * Unfollow a user
   */
  unfollow(userId) {
    return del(`/users/${userId}/follow`);
  },
  
  /**
   * Get user's followers
   */
  getFollowers(userId, page = 1, limit = 20) {
    return get(`/users/${userId}/followers`, { page, limit });
  },
  
  /**
   * Get user's following
   */
  getFollowing(userId, page = 1, limit = 20) {
    return get(`/users/${userId}/following`, { page, limit });
  },
  
  /**
   * Get suggested users to follow
   */
  getSuggestions(limit = 10) {
    return get('/users/suggestions', { limit });
  },
  
  /**
   * Search users
   */
  search(query, page = 1, limit = 20) {
    return get('/users/search', { q: query, page, limit });
  },
  
  /**
   * Block a user
   */
  block(userId) {
    return post(`/users/${userId}/block`);
  },
  
  /**
   * Unblock a user
   */
  unblock(userId) {
    return del(`/users/${userId}/block`);
  },
  
  /**
   * Get new members
   */
  getNewMembers(limit = 10) {
    return get('/users/new', { limit });
  },
};

// ==================== Search API ====================

export const search = {
  /**
   * Search posts and users
   */
  all(query, page = 1, limit = 20) {
    return get('/search', { q: query, page, limit });
  },
  
  /**
   * Search posts only
   */
  posts(query, page = 1, limit = 20) {
    return get('/search/posts', { q: query, page, limit });
  },
  
  /**
   * Search users only
   */
  users(query, page = 1, limit = 20) {
    return get('/search/users', { q: query, page, limit });
  },
};

// ==================== Notifications API ====================

export const notifications = {
  /**
   * Get notifications
   */
  get(page = 1, limit = 20) {
    return get('/notifications', { page, limit });
  },
  
  /**
   * Get unread count
   */
  getUnreadCount() {
    return get('/notifications/unread-count');
  },
  
  /**
   * Mark all as read
   */
  markAllRead() {
    return post('/notifications/mark-all-read');
  },
  
  /**
   * Mark a notification as read
   */
  markRead(notificationId) {
    return patch(`/notifications/${notificationId}/read`);
  },
  
  /**
   * Delete a notification
   */
  delete(notificationId) {
    return del(`/notifications/${notificationId}`);
  },
};

// ==================== Explore API ====================

export const explore = {
  /**
   * Get trending topics
   */
  trending(category = 'all', sort = 'hot', limit = 10) {
    return get('/explore/trending', { category, sort, limit });
  },
  
  /**
   * Get explore topics
   */
  topics(limit = 12) {
    return get('/explore/topics', { limit });
  },
  
  /**
   * Get posts for a topic
   */
  topicFeed(topic, page = 1, limit = 15) {
    return get(`/explore/topics/${encodeURIComponent(topic)}`, { page, limit });
  },
};

// ==================== Groups API ====================

export const groups = {
  /**
   * Get groups list
   */
  list(page = 1, limit = 20) {
    return get('/groups', { page, limit });
  },
  
  /**
   * Get group details
   */
  get(groupId) {
    return get(`/groups/${groupId}`);
  },
  
  /**
   * Create a group
   */
  create(name, description, avatarUrl = null) {
    return post('/groups', { name, description, avatarUrl });
  },
  
  /**
   * Update a group
   */
  update(groupId, data) {
    return patch(`/groups/${groupId}`, data);
  },
  
  /**
   * Delete a group
   */
  delete(groupId) {
    return del(`/groups/${groupId}`);
  },
  
  /**
   * Get group feed
   */
  getFeed(groupId, page = 1, limit = 15) {
    return get(`/groups/${groupId}/feed`, { page, limit });
  },
  
  /**
   * Join a group
   */
  join(groupId) {
    return post(`/groups/${groupId}/join`);
  },
  
  /**
   * Leave a group
   */
  leave(groupId) {
    return del(`/groups/${groupId}/leave`);
  },
  
  /**
   * Get group members
   */
  getMembers(groupId, page = 1, limit = 20) {
    return get(`/groups/${groupId}/members`, { page, limit });
  },
};

// ==================== DM (Direct Messages) API ====================

export const dm = {
  /**
   * Get conversations list
   */
  getConversations() {
    return get('/dm/conversations');
  },
  
  /**
   * Get messages in a conversation
   */
  getMessages(convId, limit = 20, beforeId = null) {
    const params = { limit };
    if (beforeId) params.before_id = beforeId;
    return get(`/dm/conversations/${convId}/messages`, params);
  },
  
  /**
   * Send a message
   */
  sendMessage(convId, body, encrypted = false) {
    return post(`/dm/conversations/${convId}/messages`, { body, encrypted });
  },
  
  /**
   * Get new messages since a given ID
   */
  getNewMessages(convId, afterId) {
    return get(`/dm/conversations/${convId}/messages/new`, { after_id: afterId });
  },
  
  /**
   * Mark messages as read
   */
  markRead(convId, upToId) {
    return patch(`/dm/conversations/${convId}/read`, { up_to_id: upToId });
  },
  
  /**
   * Create a conversation with a user
   */
  createConversation(recipientId) {
    return post('/dm/conversations', { recipientId });
  },
  
  /**
   * Get user presence status
   */
  getPresence(convId) {
    return get(`/dm/conversations/${convId}/presence`);
  },
  
  /**
   * Upload public key for E2E encryption
   */
  uploadPublicKey(publicKey) {
    return put('/dm/publickey', { publicKey });
  },
  
  /**
   * Get user's public key
   */
  getPublicKey(userId) {
    return get(`/users/${userId}/publickey`);
  },
};

export default {
  api,
  get,
  post,
  put,
  patch,
  del,
  auth,
  posts,
  users,
  search,
  notifications,
  explore,
  groups,
  dm,
};