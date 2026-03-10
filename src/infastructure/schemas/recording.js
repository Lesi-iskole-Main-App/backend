import mongoose from "mongoose";
const { Schema } = mongoose;

const recordingSchema = new Schema(
  {
    classId: {
      type: Schema.Types.ObjectId,
      ref: "Class",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    date: {
      type: String,
      required: true,
      trim: true, // "2026-03-09"
    },

    time: {
      type: String,
      required: true,
      trim: true, // "10:30"
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    recordingUrl: {
      type: String,
      required: true,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

recordingSchema.index(
  { classId: 1, title: 1, date: 1, time: 1 },
  { unique: true }
);

const Recording =
  mongoose.models.Recording || mongoose.model("Recording", recordingSchema);

export default Recording;