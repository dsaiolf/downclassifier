import jwt from 'jsonwebtoken';

export const login = (req, res) => {
  const { email: username, password } = req.body; // client sends field as "email"

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const jwtSecret     = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error('JWT_SECRET is not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (username.toLowerCase() !== adminUsername?.toLowerCase() || password !== adminPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username: adminUsername }, jwtSecret, { expiresIn: '24h' });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  res.json({ user: { username: adminUsername } });
};

export const logout = (_req, res) => {
  res.clearCookie('token', { httpOnly: true });
  res.json({ message: 'Logged out' });
};

export const me = (req, res) => {
  res.json({ user: req.user });
};
