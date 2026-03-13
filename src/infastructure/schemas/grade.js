import mongoose from "mongoose";
const { Schema } = mongoose;

export const AL_STREAM_ENUM = [
  "physical_science",
  "biological_science",
  "commerce",
  "arts",
  "technology",
  "common",
];

const subjectSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, auto: true },
    subject: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const streamSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, auto: true },
    stream: {
      type: String,
      required: true,
      trim: true,
      enum: AL_STREAM_ENUM,
    },
    subjects: { type: [subjectSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const gradeSchema = new Schema(
  {
    flowType: {
      type: String,
      enum: ["normal", "al"],
      required: true,
      default: "normal",
      index: true,
    },

    // normal => 1..11
    // al => 12..13
    grade: {
      type: Number,
      required: true,
      min: 1,
      max: 13,
      validate: {
        validator: function (value) {
          if (this.flowType === "normal") {
            return Number.isInteger(value) && value >= 1 && value <= 11;
          }

          if (this.flowType === "al") {
            return Number.isInteger(value) && value >= 12 && value <= 13;
          }

          return false;
        },
        message:
          "Invalid grade value. normal flow must use 1..11. al flow must use 12..13.",
      },
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    // grades 1..11 only
    subjects: { type: [subjectSchema], default: [] },

    // grades 12..13 only
    streams: { type: [streamSchema], default: [] },

    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

gradeSchema.pre("validate", function (next) {
  if (this.flowType === "normal") {
    this.streams = [];
    if (!this.title) this.title = `Grade ${this.grade}`;
  }

  if (this.flowType === "al") {
    this.subjects = [];
    if (!this.title) this.title = `Grade ${this.grade}`;
  }

  next();
});

/**
 * Correct unique index:
 * same grade number can exist only once inside each flowType
 * example:
 *   normal + 10 => unique
 *   al + 12 => unique
 */
gradeSchema.index({ flowType: 1, grade: 1 }, { unique: true });

const Grade = mongoose.models.Grade || mongoose.model("Grade", gradeSchema);
export default Grade;