// Circle App - Utility Functions

/**
 * Escape HTML special characters to prevent XSS
 */
export function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

/**
 * Format a date to a relative time string (e.g., "2h ago")
 */
export function formatTime(date) {
  if (!date) return '';
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 10) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s`;
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  
  return formatFullDate(date);
}

/**
 * Format a date to a full date string
 */
export function formatFullDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  return d.toLocaleDateString('en-US', { 
    year: 'numeric',
    month: 'short', 
    day: 'numeric'
  });
}

/**
 * Format view counts with K/M suffixes
 */
export function fmtViews(n) {
  if (!n || n === 0) return '';
  if (n < 1000) return n.toString();
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

/**
 * Generate a consistent color from a string (for avatars, etc.)
 */
export function stringToColor(str) {
  if (!str) return '#666';
  
  const colors = [
    '#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#073b4c',
    '#7c6bff', '#ff5f7a', '#22d48f', '#f5a623', '#e040fb',
    '#00bcd4', '#8bc34a', '#ff9800', '#795548', '#607d8b',
  ];
  
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Generate a stable anonymous fingerprint for guest users
 */
export function getFingerprint() {
  let fp = localStorage.getItem('circle_fp');
  if (!fp) {
    fp = 'fp_' + Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
    localStorage.setItem('circle_fp', fp);
  }
  return fp;
}

/**
 * Debounce function to limit how often a function can fire
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function to ensure a function is only called once per specified time period
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Check if we're on a mobile device
 */
export function isMobile() {
  return window.matchMedia('(max-width: 767px)').matches;
}

/**
 * Check if we're on a tablet
 */
export function isTablet() {
  return window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch (e) {
      document.body.removeChild(textArea);
      return false;
    }
  }
}

/**
 * Download a file from a URL
 */
export function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Check if an element is in the viewport
 */
export function isInViewport(element, threshold = 0) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= threshold &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Smooth scroll to an element
 */
export function scrollToElement(element, offset = 0) {
  const rect = element.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  window.scrollTo({
    top: rect.top + scrollTop - offset,
    behavior: 'smooth'
  });
}

/**
 * Parse a URL and return query parameters as an object
 */
export function parseQueryString(queryString) {
  const params = {};
  const query = queryString.startsWith('?') ? queryString.substring(1) : queryString;
  
  if (!query) return params;
  
  query.split('&').forEach(param => {
    const [key, value] = param.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value?.replace(/\+/g, ' ') || '');
  });
  
  return params;
}

/**
 * Build a query string from an object
 */
export function buildQueryString(params) {
  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

/**
 * Format a phone number for display
 */
export function formatPhoneNumber(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

/**
 * Validate an email address
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate a URL
 */
export function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '…';
}

/**
 * Generate a unique ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry(fn, retries = 3, delay = 1000, backoff = 2) {
  let lastError;
  let currentDelay = delay;
  
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        await sleep(currentDelay);
        currentDelay *= backoff;
      }
    }
  }
  
  throw lastError;
}

export default {
  escHtml,
  formatTime,
  formatFullDate,
  fmtViews,
  stringToColor,
  getFingerprint,
  debounce,
  throttle,
  isMobile,
  isTablet,
  copyToClipboard,
  downloadFile,
  isInViewport,
  scrollToElement,
  parseQueryString,
  buildQueryString,
  formatPhoneNumber,
  isValidEmail,
  isValidUrl,
  truncateText,
  generateId,
  sleep,
  retry,
};