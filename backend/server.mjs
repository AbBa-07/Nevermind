import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ethers } from 'ethers';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import Voter from './models/Voter.mjs';

const AMOY_CHAIN_ID = 80002n;
const CONTRACT_ABI = [
  'function castVote(bytes32 tokenHash, uint256 candidateId) external',
];
const TOKEN_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getConfig() {
  const port = Number(process.env.PORT ?? '5000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const contractAddress = requiredEnv('CONTRACT_ADDRESS');
  if (!ethers.isAddress(contractAddress)) {
    throw new Error('CONTRACT_ADDRESS must be a valid EVM address.');
  }

  return {
    mongoUri: requiredEnv('MONGO_URI'),
    rpcUrl: requiredEnv('RPC_URL'),
    privateKey: requiredEnv('PRIVATE_KEY'),
    contractAddress,
    port,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

function hashStudentId(studentId) {
  return createHash('sha256').update(studentId, 'utf8').digest('hex');
}

function parseCandidateId(value) {
  const validInput =
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
  if (!validInput) {
    return null;
  }

  const candidateId = BigInt(value);
  return candidateId < (1n << 256n) ? candidateId : null;
}

function createApp({ contract, provider, corsOrigins }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '16kb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const voteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
  });

  app.post('/api/auth/verify', authLimiter, async (req, res) => {
    const studentId =
      typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';
    if (!studentId || studentId.length > 256) {
      return res.status(400).json({ error: 'A valid studentId is required.' });
    }

    const studentIdHash = hashStudentId(studentId);
    const tokenHash = `0x${createHash('sha256')
      .update(randomBytes(32))
      .digest('hex')}`;

    let voter = await Voter.findOne({ studentIdHash });
    if (!voter) {
      try {
        voter = await Voter.create({ studentIdHash });
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
        voter = await Voter.findOne({ studentIdHash });
      }
    }
    if (!voter) {
      throw new Error('Could not load or create voter record.');
    }

    const authenticatedVoter = await Voter.findOneAndUpdate(
      { _id: voter._id, hasAuthenticated: false },
      { $set: { hasAuthenticated: true, tokenHash } },
      { new: true },
    );
    if (!authenticatedVoter) {
      return res.status(400).json({
        error: 'A voting credential has already been issued for this studentId.',
      });
    }

    return res.status(200).json({
      message: 'Authentication successful. Voting credential issued.',
      tokenHash,
    });
  });

  app.post('/api/vote', voteLimiter, async (req, res) => {
    const { tokenHash } = req.body ?? {};
    const candidateId = parseCandidateId(req.body?.candidateId);
    if (typeof tokenHash !== 'string' || !TOKEN_HASH_PATTERN.test(tokenHash)) {
      return res.status(400).json({ error: 'A valid tokenHash is required.' });
    }
    if (candidateId === null) {
      return res.status(400).json({ error: 'A non-negative integer candidateId is required.' });
    }

    let voter = await Voter.findOne({ tokenHash });
    if (!voter) {
      return res.status(401).json({ error: 'Invalid voting credential.' });
    }
    if (!voter.hasAuthenticated) {
      return res.status(401).json({ error: 'Invalid voting credential.' });
    }
    if (voter.hasVoted) {
      return res.status(400).json({ error: 'This voting credential has already been used.' });
    }

    if (voter.voteInProgress) {
      const outcome = await reconcileVote(voter, provider);
      if (outcome === 'confirmed') {
        return res.status(200).json({
          success: true,
          message: 'Vote recorded on-chain successfully.',
          txHash: voter.voteTxHash,
        });
      }
      if (outcome === 'pending') {
        return res.status(202).json({
          success: false,
          pending: true,
          message: 'The vote transaction is still processing.',
          ...(voter.voteTxHash ? { txHash: voter.voteTxHash } : {}),
        });
      }
      voter = await Voter.findById(voter._id);
      if (!voter) {
        return res.status(401).json({ error: 'Invalid voting credential.' });
      }
    }

    const reservation = await Voter.findOneAndUpdate(
      {
        tokenHash,
        _id: voter?._id,
        hasAuthenticated: true,
        hasVoted: false,
        voteInProgress: false,
      },
      { $set: { voteInProgress: true, voteTxHash: null } },
      { new: true },
    );
    if (!reservation) {
      const latest = await Voter.findOne({ tokenHash }).lean();
      if (latest?.hasVoted) {
        return res.status(400).json({ error: 'This voting credential has already been used.' });
      }
      return res.status(409).json({
        error: 'A vote transaction is already processing for this credential.',
      });
    }

    let transaction;
    try {
      transaction = await contract.castVote(tokenHash, candidateId);
    } catch (error) {
      await Voter.updateOne(
        { _id: reservation._id, voteInProgress: true },
        { $set: { voteInProgress: false, voteTxHash: null } },
      );
      console.error('Vote transaction submission failed:', error);
      return res.status(502).json({ error: 'The vote transaction could not be submitted.' });
    }

    try {
      const savedTransaction = await Voter.updateOne(
        { _id: reservation._id, voteInProgress: true },
        { $set: { voteTxHash: transaction.hash } },
      );
      if (savedTransaction.matchedCount !== 1) {
        throw new Error('Could not save the submitted vote transaction hash.');
      }
    } catch (error) {
      console.error('Vote submitted, but its transaction hash could not be saved:', error);
      return res.status(202).json({
        success: false,
        pending: true,
        message: 'The vote was submitted and is being reconciled.',
        txHash: transaction.hash,
      });
    }

    let receipt;
    try {
      receipt = await transaction.wait();
    } catch (error) {
      receipt = error?.receipt ?? null;
      if (!receipt) {
        try {
          receipt = await provider.getTransactionReceipt(transaction.hash);
        } catch (lookupError) {
          console.error('Could not query vote transaction receipt:', lookupError);
          receipt = null;
        }
      }
      if (!receipt) {
        console.error('Vote transaction confirmation is pending:', transaction.hash);
        return res.status(202).json({
          success: false,
          pending: true,
          message: 'The vote transaction was submitted and is awaiting confirmation.',
          txHash: transaction.hash,
        });
      }
    }

    if (!receipt) {
      return res.status(202).json({
        success: false,
        pending: true,
        message: 'The vote transaction was submitted and is awaiting confirmation.',
        txHash: transaction.hash,
      });
    }

    if (receipt.status !== 1) {
      await Voter.updateOne(
        { _id: reservation._id, voteInProgress: true },
        { $set: { voteInProgress: false, voteTxHash: null } },
      );
      return res.status(502).json({ error: 'The vote transaction failed on-chain.' });
    }

    try {
      const result = await Voter.updateOne(
        { _id: reservation._id, voteInProgress: true },
        { $set: { hasVoted: true, voteInProgress: false, voteTxHash: transaction.hash } },
      );
      if (result.matchedCount !== 1) {
        throw new Error('Voter reservation was lost before the vote could be recorded.');
      }
    } catch (error) {
      console.error('Vote confirmed, but MongoDB update failed:', error);
      return res.status(202).json({
        success: false,
        pending: true,
        message: 'The vote was confirmed on-chain and is being reconciled.',
        txHash: transaction.hash,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Vote recorded on-chain successfully.',
      txHash: transaction.hash,
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'Request body must contain valid JSON.' });
    }
    console.error('Unhandled request error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

async function reconcileVote(voter, provider) {
  if (!voter.voteTxHash) {
    return 'pending';
  }

  const receipt = await provider.getTransactionReceipt(voter.voteTxHash);
  if (!receipt) {
    return 'pending';
  }
  if (receipt.status === 1) {
    const result = await Voter.updateOne(
      { _id: voter._id, hasVoted: false },
      { $set: { hasVoted: true, voteInProgress: false } },
    );
    if (result.matchedCount !== 1) {
      const latest = await Voter.findById(voter._id).lean();
      if (!latest?.hasVoted) {
        throw new Error('Could not reconcile a confirmed vote in MongoDB.');
      }
    }
    return 'confirmed';
  }

  await Voter.updateOne(
    { _id: voter._id, hasVoted: false },
    { $set: { voteInProgress: false, voteTxHash: null } },
  );
  return 'failed';
}

export async function startServer() {
  const config = getConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const relayer = new ethers.Wallet(config.privateKey, provider);
  const contract = new ethers.Contract(config.contractAddress, CONTRACT_ABI, relayer);

  await mongoose.connect(config.mongoUri);
  await Voter.init();

  const network = await provider.getNetwork();
  if (network.chainId !== AMOY_CHAIN_ID) {
    await mongoose.disconnect();
    throw new Error(`RPC_URL must connect to Polygon Amoy (chain ID ${AMOY_CHAIN_ID}).`);
  }

  const app = createApp({
    contract,
    provider,
    corsOrigins: config.corsOrigins,
  });
  const server = app.listen(config.port, () => {
    console.log(`Voting API listening on port ${config.port} (Polygon Amoy).`);
  });

  const shutdown = () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(async (error) => {
    console.error('Failed to start voting API:', error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
