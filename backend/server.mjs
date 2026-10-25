import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { ethers } from 'ethers';

const app = express();
app.use(express.json());
app.use(cors());

// --- Blockchain Configuration (Local Hardhat Node) ---
const RPC_URL = "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Hardhat's default Account #0 private key (used as the gasless relayer wallet)
const RELAYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Minimal ABI for the Voting contract (castVote function)
const CONTRACT_ABI = [
    "function castVote(bytes32 tokenHash, uint256 candidateId) external",
    "function getCandidates() external view returns (tuple(uint256 id, string name, uint256 voteCount)[])"
];

// Setup Ethers provider and relayer wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const votingContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, relayerWallet);

// Mock Eligibility Database
const eligibleVoters = {
    "student_01": { email: "student1@college.edu", tokenIssued: false },
    "student_02": { email: "student2@college.edu", tokenIssued: false },
    "student_03": { email: "student3@college.edu", tokenIssued: false },
};

// 1. Authentication & Token Generation Endpoint
app.post('/api/auth/verify', (req, res) => {
    const { studentId } = req.body;

    if (!eligibleVoters[studentId]) {
        return res.status(403).json({ error: "Unauthorized: Student ID not found in eligibility registry." });
    }

    if (eligibleVoters[studentId].tokenIssued) {
        return res.status(400).json({ error: "Eligibility Error: A voting credential has already been issued to this ID." });
    }

    eligibleVoters[studentId].tokenIssued = true;

    // Generate an unlinkable cryptographic ephemeral token hash
    const rawSecret = studentId + crypto.randomBytes(32).toString('hex');
    const tokenHash = '0x' + crypto.createHash('sha256').update(rawSecret).digest('hex');

    return res.status(200).json({
        message: "Authentication successful. Ephemeral token generated.",
        tokenHash: tokenHash
    });
});

// 2. Gasless Relayer Vote Submission Endpoint
app.post('/api/vote', async (req, res) => {
    const { tokenHash, candidateId } = req.body;

    if (!tokenHash || candidateId === undefined) {
        return res.status(400).json({ error: "Missing tokenHash or candidateId." });
    }

    try {
        console.log(`Relaying vote for candidate ${candidateId} with token hash ${tokenHash}...`);
        
        // Submit transaction to the local blockchain via the relayer wallet
        const tx = await votingContract.castVote(tokenHash, candidateId);
        await tx.wait();

        console.log(`Vote successfully recorded on-chain! Tx Hash: ${tx.hash}`);
        return res.status(200).json({ 
            success: true, 
            message: "Vote recorded on-chain successfully!", 
            txHash: tx.hash 
        });
    } catch (err) {
        console.error("Blockchain Relay Error:", err);
        return res.status(500).json({ error: err.reason || err.message || "Failed to submit vote on-chain." });
    }
});

const PORT = 5000;
app.listen(PORT, () => {
    console.log(`CivicFlow Auth & Blockchain Relayer Backend running on port ${PORT}`);
});