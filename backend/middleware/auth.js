import jwt from 'jsonwebtoken';

export default function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const token = authorization.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      isVerified: payload.isVerified,
    };

    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
