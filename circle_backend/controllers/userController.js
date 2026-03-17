// ============================================================
//  controllers/userController.js
//  Handles all request/response logic for user routes.
//  Each function reads from req, calls the model, and
//  sends back a response. No SQL lives here.
// ============================================================

const bcrypt       = require('bcrypt');
const UserModel    = require('../models/UserModel');
const { sendOk, sendError } = require('../middleware/response');

// POST /api/users/register
async function register(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return sendError(res, 400, 'Name, email, and password are required.');

  try {
    if (await UserModel.emailExists(email))
      return sendError(res, 409, 'Email already registered.');

    const hash   = await bcrypt.hash(password, 10);
    const userId = await UserModel.createUser(name, email, hash);

    return sendOk(res, 201, 'Registered successfully.', {
      id: userId, name, email, picture: null, createdAt: new Date(),
    });
  } catch (err) {
    console.error('register error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/users/login
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return sendError(res, 400, 'Email and password are required.');

  try {
    const user = await UserModel.findByEmail(email);
    if (!user) return sendError(res, 404, 'No account with that email.');

    const match = await bcrypt.compare(password, user.password);
    if (!match) return sendError(res, 401, 'Wrong password.');

    // Never send the password hash to the client
    const { password: _, ...safeUser } = user;
    return sendOk(res, 200, 'Login successful.', safeUser);
  } catch (err) {
    console.error('login error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/users/:id/profile
async function getProfile(req, res) {
  const targetId = parseInt(req.params.id);
  const viewerId = parseInt(req.headers['x-user-id']) || null;

  try {
    const profile = await UserModel.getProfile(targetId, viewerId);
    if (!profile) return sendError(res, 404, 'User not found.');
    return sendOk(res, 200, 'Profile fetched.', profile);
  } catch (err) {
    console.error('getProfile error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/users/:id/picture
async function updatePicture(req, res) {
  const userId  = parseInt(req.params.id);
  const { picture } = req.body;

  if (req.actorId !== userId)
    return sendError(res, 403, 'Forbidden.');
  if (picture && picture.length > 7_000_000)
    return sendError(res, 413, 'Image too large (max 5 MB).');

  try {
    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    await UserModel.updatePicture(userId, picture || null);
    return sendOk(res, 200, 'Picture updated.', { picture: picture || null });
  } catch (err) {
    console.error('updatePicture error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/users/:id
async function updateProfile(req, res) {
  const userId = parseInt(req.params.id);
  const { name, email, password } = req.body;

  if (req.actorId !== userId)
    return sendError(res, 403, 'Forbidden.');
  if (!name || !email)
    return sendError(res, 400, 'Name and email are required.');

  try {
    if (await UserModel.emailTakenByOther(email, userId))
      return sendError(res, 409, 'Email already in use.');

    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await UserModel.updateUserWithPassword(userId, name, email, hash);
    } else {
      await UserModel.updateUser(userId, name, email);
    }

    const updated = await UserModel.findById(userId);
    return sendOk(res, 200, 'Profile updated.', updated);
  } catch (err) {
    console.error('updateProfile error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { register, login, getProfile, updatePicture, updateProfile };
