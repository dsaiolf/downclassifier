import jwt from 'jsonwebtoken';

export const login = (req, res) => {
  const { email: username, password } = req.body; // client sends field as "email"

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error('JWT_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Build user list: admin account + any extra users from USERS env var
  let extraUsers = [];
  try { extraUsers = JSON.parse(process.env.USERS || '[]'); } catch { extraUsers = []; }
  console.log('[auth] attempt:', username, '| extra users loaded:', extraUsers.map(u => u.username));
  const users = [
    { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
    ...extraUsers,
  ];

  const matched = users.find(
    u => u.username?.toLowerCase() === username.toLowerCase() && u.password === password
  );

  if (!matched) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username: matched.username }, jwtSecret, { expiresIn: '24h' });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  res.json({ user: { username: matched.username } });
};

export const logout = (_req, res) => {
  res.clearCookie('token', { httpOnly: true });
  res.json({ message: 'Logged out' });
};

export const me = (req, res) => {
  res.json({ user: req.user });
};
