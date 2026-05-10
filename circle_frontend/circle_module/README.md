# Circle Module

A modular JavaScript frontend architecture for the Circle social media application. This module extracts and organizes the JavaScript functionality from the monolithic HTML file into clean, maintainable ES modules.

## 📁 Module Structure

```
circle_module/
├── index.js          # Main entry point, exports all modules, app initialization
├── constants.js      # App configuration, API endpoints, constants
├── utils.js          # Utility functions (formatting, validation, helpers)
├── api.js            # API service layer with all backend endpoints
├── auth.js           # Authentication module (login, register, session)
├── ui.js             # UI utilities (theme, navigation, modals, toasts)
└── README.md         # This file
```

## 🚀 Quick Start

### Option 1: ES Modules (Recommended)

```html
<script type="module">
  import Circle from './circle_module/index.js';
  
  // The app auto-initializes, but you can also:
  // Circle.initApp();
  
  // Access modules:
  Circle.api.posts.getFeed('for-you', 1).then(posts => {
    console.log(posts);
  });
  
  Circle.auth.isLoggedIn(); // true/false
  Circle.ui.showToast('Hello!');
</script>
```

### Option 2: Individual Module Imports

```javascript
import { api, auth, ui, utils, PostCache, FollowingSet } from './circle_module/index.js';

// Use specific modules
api.posts.getPost('123').then(post => {
  ui.showToast(`Loaded: ${post.title}`);
});
```

## 📚 API Reference

### `constants` Module

Configuration values and constants used throughout the app.

```javascript
import { CONFIG, API_BASE_URL, VIEWS, FEED_TABS } from './circle_module/constants.js';

console.log(CONFIG.POSTS_PER_PAGE); // 15
console.log(API_BASE_URL); // "http://localhost:3000/api"
```

### `utils` Module

General utility functions.

```javascript
import { 
  escHtml, formatTime, formatFullDate, fmtViews, 
  stringToColor, getFingerprint, debounce, throttle,
  copyToClipboard, truncateText, isValidEmail 
} from './circle_module/utils.js';

escHtml('<script>alert("xss")</script>'); // "<script>..."
formatTime(new Date()); // "2m" or "just now"
stringToColor("username"); // "#7c6bff" (consistent color)
debounce(() => console.log('fired'), 300); // Returns debounced function
```

### `api` Module

Complete API service layer with typed methods for all endpoints.

```javascript
import { api, posts, users, auth, search, notifications, explore, groups, dm } from './circle_module/api.js';

// Generic API calls
api.get('/posts/feed', { tab: 'for-you', page: 1 });
api.post('/posts', { text: 'Hello world!' });

// Posts
posts.getFeed('for-you', 1, 15);
posts.getPost('123');
posts.createPost('Hello!', imageUrl, 'image');
posts.like('123');
posts.unlike('123');
posts.repost('123', 'Quote text');
posts.addComment('123', 'Nice post!', null);

// Users
users.getProfile('user-123');
users.updateProfile({ name: 'New Name', bio: 'Hello' });
users.follow('user-123');
users.unfollow('user-123');
users.getSuggestions(10);

// Auth
auth.login('email@example.com', 'password');
auth.register('Name', 'email@example.com', 'password');
auth.logout();

// Search
search.all('query', 1, 20);
search.posts('query');
search.users('query');

// Notifications
notifications.get(1, 20);
notifications.getUnreadCount();
notifications.markAllRead();

// Explore
explore.trending('all', 'hot', 10);
explore.topics(12);
explore.topicFeed('javascript', 1, 15);

// Groups
groups.list(1, 20);
groups.get('group-123');
groups.create('My Group', 'Description');
groups.join('group-123');
groups.getFeed('group-123', 1, 15);

// Direct Messages
dm.getConversations();
dm.getMessages('conv-123', 20);
dm.sendMessage('conv-123', 'Hello!');
dm.createConversation('user-123');
```

### `auth` Module

Authentication state management and user session handling.

```javascript
import { 
  initAuth, getCurrentUser, isLoggedIn, onAuthChange,
  register, login, logout, 
  sendPhoneOtp, verifyPhoneOtp,
  requestPasswordReset, resetPassword,
  validateRegistration, validateLogin
} from './circle_module/auth.js';

// Check auth state
isLoggedIn(); // true/false
getCurrentUser(); // { id, name, email, avatar, ... } or null

// Subscribe to auth changes
const unsubscribe = onAuthChange((user) => {
  if (user) {
    console.log('User logged in:', user.name);
  } else {
    console.log('User logged out');
  }
});

// Auth actions
const result = await login('email@example.com', 'password');
if (result.success) {
  console.log('Logged in!');
} else {
  console.error(result.error);
}

// Validation
const errors = validateRegistration('Name', 'email@example.com', 'password123');
if (errors.length === 0) {
  // Valid
}
```

### `ui` Module

UI utilities for theme, navigation, modals, toasts, and more.

```javascript
import { 
  applyTheme, getTheme, toggleTheme,
  showToast, goTo, goBack,
  openModal, closeModal,
  showAlert, hideAlert,
  showLoading, hideLoading,
  createScrollObserver, autoResizeTextarea
} from './circle_module/ui.js';

// Theme
applyTheme('dark');
toggleTheme();
getTheme(); // 'dark' or 'light'

// Navigation
goTo('profile');
goTo('post-detail', { postId: '123' });
goBack();

// Notifications
showToast('Post created successfully!');

// Modals
openModal('compose-modal');
closeModal('compose-modal');

// Alerts
showAlert(formContainer, 'Error message', 'error');
hideAlert(formContainer);

// Loading states
showLoading(feedContainer);
hideLoading(feedContainer);
setButtonLoading(button, true);

// Infinite scroll
const observer = createScrollObserver(() => {
  loadMorePosts();
});
observer.attach(feedList);
```

### `PostCache` & `FollowingSet`

In-memory caches with localStorage persistence.

```javascript
import { PostCache, FollowingSet } from './circle_module/index.js';

// Post Cache
PostCache.init();
PostCache.set('post-123', { id: 'post-123', text: 'Hello!' });
const post = PostCache.getPost('post-123');
PostCache.update('post-123', { likes: 10 });
PostCache.remove('post-123');

// Following Set
FollowingSet.init();
FollowingSet.isFollowing('user-123'); // true/false
FollowingSet.add('user-123');
FollowingSet.remove('user-123');
FollowingSet.setAll(['user-1', 'user-2', 'user-3']);
```

## 🔧 Configuration

Edit `constants.js` to customize:

```javascript
export const CONFIG = {
  POSTS_PER_PAGE: 15,
  COMMENTS_PER_PAGE: 20,
  CACHE_TTL_MS: 5 * 60 * 1000,
  FEED_POLL_INTERVAL: 15000,
  NOTIF_POLL_INTERVAL: 30000,
  // ... more settings
};
```

## 📝 Usage with Existing HTML

To use these modules with your existing HTML file:

1. Replace the inline `<script>` tag with:
```html
<script type="module" src="circle_module/index.js"></script>
```

2. The modules automatically:
   - Initialize the app
   - Set up navigation
   - Handle authentication
   - Make global functions available (`goTo`, `showToast`, etc.)

3. Keep your existing HTML structure - the modules are designed to work with the existing DOM IDs and classes.

## 🔄 Migration from Monolithic HTML

The modules were extracted from `circle_19 (2).html`. Key mappings:

| Original Function | New Module |
|------------------|------------|
| `api()` | `api.js` |
| `applyTheme()`, `toggleTheme()` | `ui.js` |
| `goTo()`, `goBack()` | `ui.js` |
| `loginUser()`, `registerUser()`, `logout()` | `auth.js` |
| `loadPosts()`, `fetchMorePosts()` | (Feed module - future) |
| `toggleLike()`, `createPost()` | (Post module - future) |
| `showToast()`, `escHtml()` | `utils.js` / `ui.js` |

## 🛠️ Future Enhancements

Additional modules that can be extracted:

- `feed.js` - Feed loading, rendering, live updates
- `post.js` - Post creation, editing, deletion
- `comments.js` - Comment management
- `notifications.js` - Notification handling
- `search.js` - Search functionality
- `dm.js` - Direct messaging UI
- `lightbox.js` - Media lightbox
- `render.js` - HTML rendering functions

## 📄 License

Part of the Circle application.