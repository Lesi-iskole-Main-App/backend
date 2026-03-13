import mongoose from "mongoose";
const { Schema } = mongoose;

const liveSchema = new Schema(
  {
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },

    scheduledAt: { type: Date, required: true },

    // backward compatibility
    zoomLink: { type: String, default: "", trim: true },

    // new multiple links
    zoomLinks: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr),
        message: "zoomLinks must be an array",
      },
    },

    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

liveSchema.index({ classId: 1, scheduledAt: -1 });

liveSchema.pre("save", function (next) {
  const cleaned = Array.isArray(this.zoomLinks)
    ? this.zoomLinks.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  if (cleaned.length > 0) {
    this.zoomLinks = cleaned;
    this.zoomLink = cleaned[0];
  } else if (this.zoomLink) {
    const single = String(this.zoomLink || "").trim();
    this.zoomLinks = single ? [single] : [];
    this.zoomLink = single;
  } else {
    this.zoomLinks = [];
    this.zoomLink = "";
  }

  next();
});

const Live = mongoose.models.Live || mongoose.model("Live", liveSchema);
export default Live;