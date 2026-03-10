import mongoose from "mongoose";
const { Schema } = mongoose;

const classSchema = new Schema(
  {
    className: { type: String, required: true, trim: true },

    // grade 1-13
    gradeId: { type: Schema.Types.ObjectId, ref: "Grade", required: true },

    // grade 1-11 => use subjectId
    subjectId: { type: Schema.Types.ObjectId, default: null },

    // grade 12-13 => use streamId + streamSubjectId
    streamId: { type: Schema.Types.ObjectId, default: null },
    streamSubjectId: { type: Schema.Types.ObjectId, default: null },

    teacherIds: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],

    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },

    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// prevent duplicates for same class setup
classSchema.index(
  {
    className: 1,
    gradeId: 1,
    subjectId: 1,
    streamId: 1,
    streamSubjectId: 1,
  },
  { unique: true }
);

const ClassModel = mongoose.models.Class || mongoose.model("Class", classSchema);
export default ClassModel;