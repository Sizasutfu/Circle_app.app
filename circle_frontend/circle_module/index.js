// Circle App - Main Entry Point
// This module exports all sub-modules and handles initialization

// Export all modules
export * from './constants.js';
export * from './utils.js';
export * from './api.js';
export * from './auth.js';
export * from './ui.js';

// Re-export specific modules as namespaces
import * as api from './api.js';
import * as auth from './auth.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as constants from './constants.js';

export { api, auth, ui, utils, constants };

// ==================== Post Cache ====================

/**
 * Simple in-memory cache for posts with localStorage persistence
 */
const PostCache = {
  _posts: new Map(),
  _storageKey: 'circle_post_cache',
  _maxSize: 100,
  
  /**
   * Initialize cache from localStorage
   */
  init() {
    try {
      const saved = localStorage.getItem(this._storageKey);
      if (saved) {
        const posts = JSON.parse(saved);
        posts.forEach(p => this.set(p.id, p));
      }
    } catch (e) {
      console.warn('Failed to initialize post cache:', e);
    }
  },
  
  /**
   * Get a post by ID
   */
  getPost(id) {
    return this._posts.get(id) || null;
  },
  
  /**
   * Set a post in cache
   */
  set(id, post) {
    this._posts.set(id, { ...post, _cachedAt: Date.now() });
    
    // Limit cache size
    if (this._posts.size > this._maxSize) {
      const entries = [...this._posts.entries()]
        .sort((a, b) => (a[1]._cachedAt || 0) - (b[1]._cachedAt || 0));
      
      // Remove oldest entries
      for (let i = 0; i < 10; i++) {
        if (entries[i]) {
          this._posts.delete(entries[i][0]);
        }
      }
    }
    
    this._save();
  },
  
  /**
   * Update a post in cache
   */
  update(id, updates) {
    const existing = this._posts.get(id);
    if (existing) {
      this._posts.set(id, { ...existing, ...updates });
      this._save();
    }
  },
  
  /**
   * Remove a post from cache
   */
  remove(id) {
    this._posts.delete(id);
    this._save();
  },
  
  /**
   * Clear entire cache
   */
  clear() {
    this._posts.clear();
    localStorage.removeItem(this._storageKey);
  },
  
  /**
   * Save to localStorage
   */
  _save() {
    try {
      const posts = [...this._posts.values()];
      localStorage.setItem(this._storageKey, JSON.stringify(posts));
    } catch (e) {
      // Storage might be full, clear old entries
      if (e.name === 'QuotaExceededError') {
        const entries = [...this._posts.entries()]
          .sort((a, b) => (a[1]._cachedAt || 0) - (b[1]._cachedAt || 0));
        
        for (let i = 0; i < 20 && this._posts.size > 20; i++) {
          if (entries[i]) {
            this._posts.delete(entries[i][0]);
          }
        }
        this._save();
      }
    }
  },
  
  /**
   * Get all cached posts
   */
  getAll() {
    return [...this._posts.values()];
  },
  
  /**
   * Check if post is cached
   */
  has(id) {
    return this._posts.has(id);
  },
};

export { PostCache };

// ==================== Following Set Cache ====================

/**
 * Cache for tracking which users the current user follows
 */
const FollowingSet = {
  _set: new Set(),
  _loaded: false,
  _storageKey: 'circle_following_set',
  
  /**
   * Initialize from localStorage
   */
  init() {
    try {
      const saved = localStorage.getItem(this._storageKey);
      if (saved) {
        const ids = JSON.parse(saved);
        ids.forEach(id => this._set.add(id));
        this._loaded = true;
      }
    } catch (e) {
      console.warn('Failed to initialize following set:', e);
    }
  },
  
  /**
   * Check if following a user
   */
  isFollowing(userId) {
    return this._set.has(userId);
  },
  
  /**
   * Add user to following set
   */
  add(userId) {
    this._set.add(userId);
    this._save();
  },
  
  /**
   * Remove user from following set
   */
  remove(userId) {
    this._set.delete(userId);
    this._save();
  },
  
  /**
   * Set the entire following list
   */
  setAll(userIds) {
    this._set = new Set(userIds);
    this._loaded = true;
    this._save();
  },
  
  /**
   * Get all following user IDs
   */
  getAll() {
    return [...this._set];
  },
  
  /**
   * Clear the set
   */
  clear() {
    this._set.clear();
    this._loaded = false;
    localStorage.removeItem(this._storageKey);
  },
  
  /**
   * Save to localStorage
   */
  _save() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify([...this._set]));
    } catch (e) {
      console.warn('Failed to save following set:', e);
    }
  },
};

export { FollowingSet };

// ==================== App Initialization ====================

/**
 * Initialize the Circle app
 */
export async function initApp() {
  console.log('🔵 Circle App initializing...');
  
  try {
    // 1. Initialize UI (theme, navigation)
    ui.initUI();
    
    // 2. Initialize caches
    PostCache.init();
    FollowingSet.init();
    
    // 3. Initialize auth
    auth.initAuth();
    
    // 4. Setup auth change listeners
    auth.onAuthChange((user) => {
      if (user) {
        FollowingSet.init(); // Reload following set for logged in user
      } else {
        FollowingSet.clear();
      }
      
      // Update UI based on auth state
      updateAuthUI(user);
    });
    
    // 5. Setup global event handlers
    setupGlobalHandlers();
    
    // 6. Initial view
    ui.goTo('feed');
    
    console.log('✅ Circle App initialized successfully');
    
  } catch (error) {
    console.error('❌ Error initializing Circle App:', error);
  }
}

/**
 * Update UI based on authentication state
 */
function updateAuthUI(user) {
  const authElements = document.querySelectorAll('[data-auth]');
  
  authElements.forEach(el => {
    const requiresAuth = el.dataset.auth === 'required';
    const requiresGuest = el.dataset.auth === 'guest';
    
    if (requiresAuth && !user) {
      el.style.display = 'none';
    } else if (requiresGuest && user) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
    }
  });
  
  // Update user info displays
  if (user) {
    const userNameEls = document.querySelectorAll('.user-name-display');
    userNameEls.forEach(el => {
      el.textContent = user.name || 'User';
    });
    
    const userAvEls = document.querySelectorAll('.user-av-display');
    userAvEls.forEach(el => {
      if (user.avatar) {
        el.innerHTML = `<img src="${escHtml(user.avatar)}" alt="">`;
      } else {
        const initial = (user.name || 'U').charAt(0).toUpperCase();
        el.textContent = initial;
      }
    });
  }
}

/**
 * Setup global event handlers
 */
function setupGlobalHandlers() {
  // Make functions globally available for onclick handlers
  window.goTo = ui.goTo;
  window.goBack = ui.goBack;
  window.showToast = ui.showToast;
  window.toggleTheme = ui.toggleTheme;
  
  // Handle visibility change (pause/resume polling)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Pause background activities
      window._circlePaused = true;
    } else {
      // Resume background activities
      window._circlePaused = false;
    }
  });
  
  // Handle online/offline
  window.addEventListener('online', () => {
    ui.showToast('Back online!');
  });
  
  window.addEventListener('offline', () => {
    ui.showToast('You are offline. Some features may not work.');
  });
  
  // Prevent accidental navigation away
  window.addEventListener('beforeunload', (e) => {
    // Only warn if there's unsaved work
    const hasUnsavedCompose = document.querySelector('#compose-textarea:not(:placeholder-shown)');
    if (hasUnsavedCompose) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ==================== Default Export ====================

export default {
  // Modules
  api,
  auth,
  ui,
  utils,
  constants,
  
  // Cache classes
  PostCache,
  FollowingSet,
  
  // Init function
  initApp,
};

// ==================== Auto-init when DOM is ready ====================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}