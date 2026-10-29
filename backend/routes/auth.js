import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
    },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );
}

router.post('/register', async (req, res, next) => {
  try {
    const name = req.body?.name?.trim();
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;

    if (
      typeof name !== 'string' ||
      !name ||
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(400).json({
        error: 'Provide a name, valid email, and password of 8–128 characters.',
      });
    }

    const existing = await User.findOne({ email }).lean();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 12),
      role: 'voter',
      isVerified: false,
    });

    return res.status(201).json({
      message: 'Registration submitted. An administrator must approve your account.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.role === 'voter' && !user.isVerified) {
      return res.status(403).json({ error: 'Your account is awaiting administrator approval.' });
    }

    return res.json({
      token: createToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
