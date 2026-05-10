// Circle App - Constants and Configuration

export const API_BASE_URL = 'http://localhost:5000 '+ '/api'

export const CONFIG = {
  // Pagination
  POSTS_PER_PAGE: 15,
  MIX_PER_PAGE: 5,
  COMMENTS_PER_PAGE: 20,
  
  // Cache settings
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  SEARCH_CACHE_MAX: 60,
  
  // Polling intervals
  FEED_POLL_INTERVAL: 15000, // 15 seconds
  NOTIF_POLL_INTERVAL: 30000, // 30 seconds
  DM_POLL_INTERVAL: 10000, // 10 seconds
  PRESENCE_POLL_INTERVAL: 15000, // 15 seconds
  HEARTBEAT_INTERVAL: 45000, // 45 seconds
  
  // View tracking
  VIEW_RECORD_DELAY: 1000, // 1 second before recording view
  
  // Media
  IMAGE_MAX_WIDTH: 1920,
  IMAGE_MAX_HEIGHT: 1080,
  IMAGE_QUALITY: 0.82,
  
  // Character limits
  POST_MAX_LENGTH: 5000,
  COMMENT_MAX_LENGTH: 1000,
  BIO_MAX_LENGTH: 200,
  
  // Suggestion limits
  SUGGESTIONS_PER_LOAD: 10,
  TRENDING_MAX: 10,
  EXPLORE_PEOPLE_MAX: 15,
  EXPLORE_TOPICS_MAX: 12,
  NEW_MEMBERS_MAX: 10,
  
  // DM
  DM_MESSAGES_PER_LOAD: 20,
  
  // Groups
  GROUPS_PER_PAGE: 20,
};

export const VIEWS = [
  'feed',
  'profile',
  'search',
  'explore',
  'groups',
  'notifications',
  'messages',
  'settings',
  'login',
  'register',
  'reset-password',
  'new-password',
  'post-detail',
];

export const FEED_TABS = ['for-you', 'following', 'local'];

export const NOTIFICATION_TYPES = {
  LIKE: 'like',
  COMMENT: 'comment',
  FOLLOW: 'follow',
  REPOST: 'repost',
  MENTION: 'mention',
  REPLY: 'reply',
};

export const POST_MENU_ACTIONS = {
  EDIT: 'edit',
  DELETE: 'delete',
  REPORT: 'report',
  NOT_INTERESTED: 'not-interested',
  BLOCK: 'block',
  FOLLOW_AUTHOR: 'follow-author',
};

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or misleading' },
  { value: 'harassment', label: 'Harassment or hate speech' },
  { value: 'violence', label: 'Violence or dangerous content' },
  { value: 'nsfw', label: 'NSFW content' },
  { value: 'copyright', label: 'Copyright infringement' },
  { value: 'other', label: 'Other' },
];

export const DIAL_COUNTRIES = [
  { code: '+1', name: 'US/Canada', flag: '🇺🇸' },
  { code: '+44', name: 'UK', flag: '🇬🇧' },
  { code: '+27', name: 'South Africa', flag: '🇿🇦' },
  { code: '+234', name: 'Nigeria', flag: '🇳🇬' },
  { code: '+254', name: 'Kenya', flag: '🇰🇪' },
  { code: '+91', name: 'India', flag: '🇮🇳' },
  { code: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: '+33', name: 'France', flag: '🇫🇷' },
  { code: '+81', name: 'Japan', flag: '🇯🇵' },
];

export const TRENDING_CATEGORIES = ['all', 'tech', 'sports', 'entertainment', 'politics', 'science'];

export const TRENDING_SORTS = ['hot', 'recent', 'top'];

export default {
  API_BASE_URL,
  CONFIG,
  VIEWS,
  FEED_TABS,
  NOTIFICATION_TYPES,
  POST_MENU_ACTIONS,
  REPORT_REASONS,
  DIAL_COUNTRIES,
  TRENDING_CATEGORIES,
  TRENDING_SORTS,
};