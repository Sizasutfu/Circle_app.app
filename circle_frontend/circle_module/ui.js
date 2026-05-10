// Circle App - UI Module

import { debounce } from './utils.js';

// ==================== Theme ====================

/**
 * Apply theme to document
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('circle_theme', theme);
}

/**
 * Get current theme
 */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

/**
 * Toggle between light and dark theme
 */
export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

/**
 * Initialize theme from localStorage or system preference
 */
export function initTheme() {
  const saved = localStorage.getItem('circle_theme');
  if (saved) {
    applyTheme(saved);
  } else {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('circle_theme')) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// ==================== Toast Notifications ====================

let toastTimeout = null;

/**
 * Show a toast notification
 */
export function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  // Clear any existing timeout
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  
  toast.textContent = message;
  toast.classList.add('show');
  
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Hide toast
 */
export function hideToast() {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.classList.remove('show');
  }
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
}

// ==================== Navigation / View Management ====================

let viewHistory = ['feed'];
let currentView = 'feed';

/**
 * Navigate to a view
 */
export function goTo(view, opts = {}) {
  const views = document.querySelectorAll('.view');
  const targetView = document.getElementById(`view-${view}`);
  
  if (!targetView) {
    console.warn(`View "${view}" not found`);
    return;
  }
  
  // Hide all views
  views.forEach(v => v.classList.remove('active'));
  
  // Show target view
  targetView.classList.add('active');
  
  // Update history
  if (!opts.replace) {
    viewHistory.push(view);
  } else {
    viewHistory[viewHistory.length - 1] = view;
  }
  
  currentView = view;
  
  // Update sidebar active state
  updateSidebarActive(view);
  
  // Update back button visibility
  updateBackButtons(view);
  
  // Update mobile nav
  updateMobileNav(view);
  
  // Trigger view-specific loading
  const loadEvent = new CustomEvent('viewchange', { detail: { view, opts } });
  document.dispatchEvent(loadEvent);
}

/**
 * Go back to previous view
 */
export function goBack() {
  if (viewHistory.length <= 1) return;
  
  // Remove current view
  viewHistory.pop();
  
  // Get previous view
  const prevView = viewHistory[viewHistory.length - 1];
  
  // Navigate without adding to history
  goTo(prevView, { replace: true });
}

/**
 * Update sidebar active state
 */
function updateSidebarActive(view) {
  document.querySelectorAll('.sidebar .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeItem = document.getElementById(`snav-${view}`);
  if (activeItem) {
    activeItem.classList.add('active');
  }
}

/**
 * Update back button visibility
 */
function updateBackButtons(view) {
  const showBack = view !== 'feed';
  
  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.style.display = showBack ? '' : 'none';
  });
}

/**
 * Update mobile navigation active state
 */
function updateMobileNav(view) {
  document.querySelectorAll('.mobile-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const activeItem = document.querySelector(`.mobile-nav #mnav-${view}`);
  if (activeItem) {
    activeItem.classList.add('active');
  }
}

/**
 * Initialize navigation
 */
export function initNavigation() {
  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    if (viewHistory.length > 1) {
      goBack();
    }
  });
  
  // Handle sidebar clicks
  document.querySelectorAll('.sidebar .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.id.replace('snav-', '');
      goTo(view);
    });
  });
  
  // Handle mobile nav clicks
  document.querySelectorAll('.mobile-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.id.replace('mnav-', '');
      goTo(view);
    });
  });
}

// ==================== Modal Management ====================

/**
 * Open a modal
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  
  // Focus first focusable element
  const firstFocusable = modal.querySelector('input, textarea, button, select, [tabindex]:not([tabindex="-1"])');
  if (firstFocusable) {
    setTimeout(() => firstFocusable.focus(), 100);
  }
}

/**
 * Close a modal
 */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

/**
 * Close modal when clicking backdrop
 */
export function setupModalBackdropClose(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modalId);
    }
  });
}

/**
 * Close modal on escape key
 */
export function setupModalEscapeClose(modalId) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById(modalId);
      if (modal && modal.classList.contains('open')) {
        closeModal(modalId);
      }
    }
  });
}

// ==================== Alert/Confirmation ====================

/**
 * Show an alert in a form
 */
export function showAlert(container, message, type = 'error') {
  const alert = container.querySelector('.alert') || document.createElement('div');
  alert.className = `alert ${type}`;
  alert.textContent = message;
  alert.style.display = 'block';
  
  if (!container.querySelector('.alert')) {
    container.insertBefore(alert, container.firstChild);
  }
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    alert.style.display = 'none';
  }, 5000);
}

/**
 * Hide alert
 */
export function hideAlert(container) {
  const alert = container.querySelector('.alert');
  if (alert) {
    alert.style.display = 'none';
  }
}

// ==================== Loading States ====================

/**
 * Show loading spinner
 */
export function showLoading(container) {
  if (!container) return;
  
  const existing = container.querySelector('.loading-spinner');
  if (existing) return;
  
  const spinner = document.createElement('div');
  spinner.className = 'loading-spinner';
  spinner.innerHTML = '<div class="spinner"></div>';
  container.appendChild(spinner);
}

/**
 * Hide loading spinner
 */
export function hideLoading(container) {
  if (!container) return;
  
  const spinner = container.querySelector('.loading-spinner');
  if (spinner) {
    spinner.remove();
  }
}

/**
 * Set button loading state
 */
export function setButtonLoading(button, loading) {
  if (!button) return;
  
  if (loading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = button.dataset.loadingText || 'Loading...';
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
}

// ==================== Scroll Handling ====================

/**
 * Create an intersection observer for infinite scroll
 */
export function createScrollObserver(callback, options = {}) {
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'height: 40px; margin-top: 8px;';
  
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      callback();
    }
  }, {
    rootMargin: options.rootMargin || '100px',
    ...options
  });
  
  observer.observe(sentinel);
  
  return {
    sentinel,
    disconnect: () => observer.disconnect(),
    attach: (parent) => parent.appendChild(sentinel),
    remove: () => sentinel.remove()
  };
}

// ==================== Form Helpers ====================

/**
 * Auto-resize textarea
 */
export function autoResizeTextarea(textarea) {
  if (!textarea) return;
  
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

/**
 * Setup character counter
 */
export function setupCharCounter(input, counterEl, max) {
  const update = () => {
    const count = input.value.length;
    counterEl.textContent = `${count}/${max}`;
    
    if (count > max * 0.9) {
      counterEl.classList.add('warning');
    } else {
      counterEl.classList.remove('warning');
    }
    
    if (count >= max) {
      counterEl.classList.add('error');
    } else {
      counterEl.classList.remove('error');
    }
  };
  
  input.addEventListener('input', debounce(update, 100));
  update();
}

// ==================== Responsive Helpers ====================

/**
 * Check if element is visible on mobile
 */
export function isMobileView() {
  return window.matchMedia('(max-width: 767px)').matches;
}

/**
 * Check if element is visible on desktop
 */
export function isDesktopView() {
  return window.matchMedia('(min-width: 1100px)').matches;
}

// ==================== Initialization ====================

/**
 * Initialize all UI components
 */
export function initUI() {
  initTheme();
  initNavigation();
  
  // Setup modal backdrop closes
  ['compose-modal', 'edit-post-modal', 'report-modal', 'quote-modal', 'lightbox', 'dm-new-modal'].forEach(id => {
    setupModalBackdropClose(id);
    setupModalEscapeClose(id);
  });
  
  // Setup global event listeners
  setupGlobalListeners();
}

/**
 * Setup global event listeners
 */
function setupGlobalListeners() {
  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    }
  });
  
  // Handle scroll for topbar hide/show
  let lastScrollY = window.scrollY;
  const topbar = document.querySelector('.topbar');
  
  if (topbar) {
    window.addEventListener('scroll', debounce(() => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        topbar.classList.add('topbar-hidden');
      } else {
        topbar.classList.remove('topbar-hidden');
      }
      
      lastScrollY = currentScrollY;
    }, 100));
  }
}

export default {
  applyTheme,
  getTheme,
  toggleTheme,
  initTheme,
  showToast,
  hideToast,
  goTo,
  goBack,
  initNavigation,
  openModal,
  closeModal,
  setupModalBackdropClose,
  setupModalEscapeClose,
  showAlert,
  hideAlert,
  showLoading,
  hideLoading,
  setButtonLoading,
  createScrollObserver,
  autoResizeTextarea,
  setupCharCounter,
  isMobileView,
  isDesktopView,
  initUI,
};