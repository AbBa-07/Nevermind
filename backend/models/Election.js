import mongoose from "mongoose";

const electionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    description: {
      type: String,
      default: "",
      maxlength: 2000
    },
    candidates: [
      {
        name: {
          type: String,
          required: true,
          trim: true
        },
        description: {
          type: String,
          default: ""
        },
        candidateAddress: {
          type: String,
          default: ""
        }
      }
    ],
    startTime: {
      type: Date,
      required: true
    },
    endTime: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "completed"],
      default: "draft"
    },
    contractAddress: {
      type: String,
      default: ""
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

electionSchema.pre("validate", function () {
  if (
    this.startTime &&
    this.endTime &&
    this.endTime <= this.startTime
  ) {
    this.invalidate("endTime", "End time must be after start time");
  }
});

export default mongoose.model("Election", electionSchema);
