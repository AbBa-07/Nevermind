import express from 'express';
import mongoose from 'mongoose';
import Election from '../models/Election.js';
import authenticateToken from '../middleware/auth.js';
import requireAdmin from '../middleware/admin.js';

const router = express.Router();

const CONTRACT_CANDIDATES = [
  { id: 0, name: 'Candidate #0' },
  { id: 1, name: 'Candidate #1' },
  { id: 2, name: 'Candidate #2' },
];

router.get('/', async (_req, res, next) => {
  try {
    const elections = await Election.find()
      .select('-__v')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      elections: elections.map((election) => ({
        ...election,
        contractCandidates: CONTRACT_CANDIDATES,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/contract-candidates', (_req, res) => {
  res.json({
    chainId: 80002,
    candidates: CONTRACT_CANDIDATES,
  });
});

router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { title, description = '', startTime, endTime } = req.body ?? {};

    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.trim().length > 200 ||
      typeof description !== 'string' ||
      description.length > 2000
    ) {
      return res.status(400).json({
        error: 'A title and a description of at most 2000 characters are required.',
      });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (
      typeof startTime !== 'string' ||
      typeof endTime !== 'string' ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return res.status(400).json({
        error: 'Provide valid start and end times, with the end after the start.',
      });
    }

    const election = await Election.create({
      title: title.trim(),
      description: description.trim(),
      startTime: start,
      endTime: end,
      status: 'draft',
      candidates: CONTRACT_CANDIDATES.map(({ name }) => ({ name })),
      contractAddress: process.env.CONTRACT_ADDRESS ?? '',
      createdBy: req.user.id,
    });

    return res.status(201).json({
      message: 'Election metadata created. The deployed contract was not changed.',
      election,
    });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({ error: error.message });
    }

    next(error);
  }
});

export default router;
