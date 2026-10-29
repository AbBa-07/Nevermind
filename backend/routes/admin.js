import express from 'express';
import User from '../models/User.js';
import authenticateToken from '../middleware/auth.js';
import requireAdmin from '../middleware/admin.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get('/pending-voters', async (_req, res, next) => {
  try {
    const voters = await User.find({
      role: 'voter',
      isVerified: false,
    })
      .select('name email createdAt')
      .sort({ createdAt: 1 })
      .lean();

    res.json({ voters });
  } catch (error) {
    next(error);
  }
});

router.patch('/voters/:id/approve', async (req, res, next) => {
  try {
    const voter = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        role: 'voter',
        isVerified: false,
      },
      { $set: { isVerified: true } },
      { new: true, runValidators: true }
    ).select('name email role isVerified');

    if (!voter) {
      return res.status(404).json({ error: 'Pending voter not found.' });
    }

    res.json({ message: 'Voter approved.', voter });
  } catch (error) {
    if (error?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid voter ID.' });
    }
    next(error);
  }
});

router.patch('/voters/:id/reject', async (req, res, next) => {
  try {
    const voter = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'voter',
      isVerified: false,
    });

    if (!voter) {
      return res.status(404).json({ error: 'Pending voter not found.' });
    }

    res.json({ message: 'Pending voter registration rejected.' });
  } catch (error) {
    next(error);
  }
});

export default router;
