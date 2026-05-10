// Circle App - Authentication Module

import { auth as authApi } from './api.js';
import { isValidEmail } from './utils.js';
import { showToast } from './ui.js';

// State
let currentUser = null;
let authListeners = [];

/**
 * Initialize auth state from localStorage
 */
export function initAuth() {
  const savedUser = localStorage.getItem('circle_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      // Verify token is still valid
      authApi.me()
        .then(user => {
          currentUser = user;
          saveUser();
          notifyAuthChange();
        })
        .catch(() => {
          // Token invalid, clear auth
          logout();
        });
    } catch (e) {
      logout();
    }
  }
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Check if user is logged in
 */
export function isLoggedIn() {
  return currentUser !== null;
}

/**
 * Save user to localStorage
 */
function saveUser() {
  if (currentUser) {
    localStorage.setItem('circle_user', JSON.stringify(currentUser));
  } else {
    localStorage.removeItem('circle_user');
  }
}

/**
 * Set current user and notify listeners
 */
function setCurrentUser(user) {
  currentUser = user;
  saveUser();
  notifyAuthChange();
}

/**
 * Subscribe to auth state changes
 */
export function onAuthChange(callback) {
  authListeners.push(callback);
  return () => {
    authListeners = authListeners.filter(cb => cb !== callback);
  };
}

/**
 * Notify all auth listeners of state change
 */
function notifyAuthChange() {
  authListeners.forEach(cb => cb(currentUser));
}

/**
 * Register a new user
 */
export async function register(name, email, password) {
  try {
    const data = await authApi.register(name, email, password);
    handleAuthSuccess(data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Login with email and password
 */
export async function login(email, password) {
  try {
    const data = await authApi.login(email, password);
    handleAuthSuccess(data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Login with phone - send OTP
 */
export async function sendPhoneOtp(dialCode, phone) {
  try {
    const data = await authApi.sendPhoneOtp(dialCode, phone);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Login with phone - verify OTP
 */
export async function verifyPhoneOtp(dialCode, phone, otp) {
  try {
    const data = await authApi.verifyPhoneOtp(dialCode, phone, otp);
    handleAuthSuccess(data);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Request password reset email
 */
export async function requestPasswordReset(email) {
  try {
    await authApi.requestPasswordReset(email);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Reset password with token
 */
export async function resetPassword(token, newPassword) {
  try {
    await authApi.resetPassword(token, newPassword);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Logout user
 */
export async function logout() {
  try {
    await authApi.logout();
  } catch (e) {
    // Ignore errors on logout
  }
  
  currentUser = null;
  localStorage.removeItem('circle_user');
  localStorage.removeItem('circle_token');
  notifyAuthChange();
}

/**
 * Handle successful authentication
 */
function handleAuthSuccess(data) {
  // Store token
  if (data.token) {
    localStorage.setItem('circle_token', data.token);
  }
  
  // Set user
  if (data.user) {
    setCurrentUser(data.user);
  } else if (data.token && !data.user) {
    // Fetch user data if not provided
    authApi.me().then(user => {
      setCurrentUser(user);
    }).catch(() => {
      // Token might be invalid
      logout();
    });
  }
  
  showToast('Welcome back!');
}

/**
 * Validate registration form
 */
export function validateRegistration(name, email, password) {
  const errors = [];
  
  if (!name || name.trim().length < 2) {
    errors.push('Name must be at least 2 characters');
  }
  
  if (!email || !isValidEmail(email)) {
    errors.push('Please enter a valid email address');
  }
  
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  
  return errors;
}

/**
 * Validate login form
 */
export function validateLogin(email, password) {
  const errors = [];
  
  if (!email || email.trim().length === 0) {
    errors.push('Email is required');
  }
  
  if (!password || password.length === 0) {
    errors.push('Password is required');
  }
  
  return errors;
}

/**
 * Validate phone number
 */
export function validatePhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 8 || cleaned.length > 15) {
    return ['Please enter a valid phone number'];
  }
  return [];
}

/**
 * Validate OTP
 */
export function validateOtp(otp) {
  if (!otp || otp.length !== 6) {
    return ['Please enter a valid 6-digit OTP'];
  }
  return [];
}

export default {
  initAuth,
  getCurrentUser,
  isLoggedIn,
  onAuthChange,
  register,
  login,
  sendPhoneOtp,
  verifyPhoneOtp,
  requestPasswordReset,
  resetPassword,
  logout,
  validateRegistration,
  validateLogin,
  validatePhone,
  validateOtp,
};