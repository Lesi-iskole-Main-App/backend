import mongoose from "mongoose";
const { Schema } = mongoose;

const classSchema = new Schema(
  {
    className: { type: String, required: true, trim: true },

    // ✅ NEW
    batchNumber: { type: String, required: true, trim: true, index: true },

    // normal grade doc OR single al doc
    gradeId: { type: Schema.Types.ObjectId, ref: "Grade", required: true },

    // grades 1-11
    subjectId: { type: Schema.Types.ObjectId, default: null },

    // A/L
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

// normal duplicate
classSchema.index(
  {
    className: 1,
    batchNumber: 1,
    gradeId: 1,
    subjectId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      subjectId: { $type: "objectId" },
    },
  }
);

// A/L duplicate
classSchema.index(
  {
    className: 1,
    batchNumber: 1,
    gradeId: 1,
    streamId: 1,
    streamSubjectId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      streamId: { $type: "objectId" },
      streamSubjectId: { $type: "objectId" },
    },
  }
);

const ClassModel = mongoose.models.Class || mongoose.model("Class", classSchema);
export default ClassModel;