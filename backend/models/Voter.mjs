import mongoose from 'mongoose';

const voterSchema = new mongoose.Schema(
  {
    studentIdHash: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    hasAuthenticated: {
      type: Boolean,
      default: false,
      required: true,
    },
    hasVoted: {
      type: Boolean,
      default: false,
      required: true,
    },
    tokenHash: {
      type: String,
      unique: true,
      sparse: true,
    },
    voteInProgress: {
      type: Boolean,
      default: false,
      required: true,
    },
    voteTxHash: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

const Voter =
  mongoose.models.Voter ?? mongoose.model('Voter', voterSchema);

export default Voter;
