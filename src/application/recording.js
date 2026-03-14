import mongoose from "mongoose";
import Recording from "../infastructure/schemas/recording.js";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import Enrollment from "../infastructure/schemas/enrollment.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getSubjectNameFromGrade = (gradeDoc, classObj) => {
  if (!gradeDoc || !classObj) return "—";

  if (classObj?.subjectId && Array.isArray(gradeDoc.subjects)) {
    const foundSubject = gradeDoc.subjects.find(
      (s) => String(s?._id) === String(classObj.subjectId)
    );
    if (foundSubject?.subject) return foundSubject.subject;
  }

  if (
    classObj?.streamId &&
    classObj?.streamSubjectId &&
    Array.isArray(gradeDoc.streams)
  ) {
    const foundStream = gradeDoc.streams.find(
      (st) => String(st?._id) === String(classObj.streamId)
    );

    if (foundStream?.subjects?.length) {
      const foundStreamSubject = foundStream.subjects.find(
        (sub) => String(sub?._id) === String(classObj.streamSubjectId)
      );
      if (foundStreamSubject?.subject) return foundStreamSubject.subject;
    }
  }

  return "—";
};

const buildClassDetails = (classDoc, gradeDoc) => {
  if (!classDoc) {
    return {
      className: "—",
      grade: null,
      subject: "—",
      teachers: [],
    };
  }

  const classObj = classDoc.toObject ? classDoc.toObject() : classDoc;

  const teachers =
    (classObj.teacherIds || []).map((t) => t?.name).filter(Boolean) || [];

  const subject = getSubjectNameFromGrade(gradeDoc, classObj);

  return {
    className: classObj.className || "—",
    grade: gradeDoc?.grade ?? null,
    subject,
    teachers,
  };
};

const requireApprovedEnrollment = async (studentId, classId) => {
  return Enrollment.findOne({
    studentId,
    classId,
    status: "approved",
    isActive: true,
  }).lean();
};

// CREATE by classId
export const createRecordingByClassId = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { title, date, time, description, recordingUrl } = req.body;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!title || !date || !time || !recordingUrl) {
      return res.status(400).json({
        message: "title, date, time and recordingUrl are required",
      });
    }

    const foundClass = await ClassModel.findById(classId);
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const recording = await Recording.create({
      classId,
      title: String(title).trim(),
      date: String(date).trim(),
      time: String(time).trim(),
      description: description ? String(description).trim() : "",
      recordingUrl: String(recordingUrl).trim(),
      createdBy: req.user?.id || null,
    });

    return res.status(201).json({
      message: "Recording created successfully",
      recording,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message:
          "A recording with the same title, date and time already exists in this class",
      });
    }
    next(err);
  }
};

// GET all recordings by classId
export const getAllRecordingByClassId = async (req, res, next) => {
  try {
    const { classId } = req.params;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const foundClass = await ClassModel.findById(classId).populate(
      "teacherIds",
      "name"
    );

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const role = String(req.user?.role || "").toLowerCase();
    if (role === "student") {
      const approved = await requireApprovedEnrollment(req.user?.id, classId);
      if (!approved) {
        return res.status(403).json({
          message: "Only approved enrolled students can view recordings",
        });
      }
    }

    const gradeDoc = await Grade.findById(foundClass.gradeId).lean();

    const recordings = await Recording.find({
      classId,
      isActive: true,
    }).sort({ createdAt: -1 });

    const mapped = recordings.map((r) => ({
      ...r.toObject(),
      classDetails: buildClassDetails(foundClass, gradeDoc),
    }));

    return res.status(200).json({
      message: "Recordings fetched successfully",
      recordings: mapped,
    });
  } catch (err) {
    next(err);
  }
};

// GET one recording by classId and recordingId
export const getRecordingByClassIdAndRecordingId = async (req, res, next) => {
  try {
    const { classId, recordingId } = req.params;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Invalid recordingId" });
    }

    const foundClass = await ClassModel.findById(classId).populate(
      "teacherIds",
      "name"
    );

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const role = String(req.user?.role || "").toLowerCase();
    if (role === "student") {
      const approved = await requireApprovedEnrollment(req.user?.id, classId);
      if (!approved) {
        return res.status(403).json({
          message: "Only approved enrolled students can view recordings",
        });
      }
    }

    const gradeDoc = await Grade.findById(foundClass.gradeId).lean();

    const recording = await Recording.findOne({
      _id: recordingId,
      classId,
      isActive: true,
    });

    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    return res.status(200).json({
      message: "Recording fetched successfully",
      recording: {
        ...recording.toObject(),
        classDetails: buildClassDetails(foundClass, gradeDoc),
      },
    });
  } catch (err) {
    next(err);
  }
};

// UPDATE
export const updateRecordingByClassId = async (req, res, next) => {
  try {
    const { classId, recordingId } = req.params;
    const { title, date, time, description, recordingUrl, isActive } = req.body;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Invalid recordingId" });
    }

    const recording = await Recording.findOne({
      _id: recordingId,
      classId,
    });

    if (!recording) {
      return res.status(404).json({ message: "Recording not found" });
    }

    if (title !== undefined) recording.title = String(title).trim();
    if (date !== undefined) recording.date = String(date).trim();
    if (time !== undefined) recording.time = String(time).trim();
    if (description !== undefined) {
      recording.description = String(description).trim();
    }
    if (recordingUrl !== undefined) {
      recording.recordingUrl = String(recordingUrl).trim();
    }
    if (isActive !== undefined) recording.isActive = Boolean(isActive);

    await recording.save();

    return res.status(200).json({
      message: "Recording updated successfully",
      recording,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message:
          "A recording with the same title, date and time already exists in this class",
      });
    }
    next(err);
  }
};

// DELETE
export const deleteRecordingByClassId = async (req, res, next) => {
  try {
    const { classId, recordingId } = req.params;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!isValidObjectId(recordingId)) {
      return res.status(400).json({ message: "Invalid recordingId" });
    }

    const deleted = await Recording.findOneAndDelete({
      _id: recordingId,
      classId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Recording not found" });
    }

    return res.status(200).json({
      message: "Recording deleted successfully",
      recording: deleted,
    });
  } catch (err) {
    next(err);
  }
};

// GET all recordings for admin table
export const getAllRecordings = async (req, res, next) => {
  try {
    const recordings = await Recording.find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    const classIds = [...new Set(recordings.map((r) => String(r.classId)))];

    const classes = await ClassModel.find({ _id: { $in: classIds } })
      .populate("teacherIds", "name")
      .lean();

    const gradeIds = [
      ...new Set(classes.map((c) => String(c.gradeId)).filter(Boolean)),
    ];

    const grades = await Grade.find({ _id: { $in: gradeIds } }).lean();
    const gradeMap = new Map(grades.map((g) => [String(g._id), g]));
    const classMap = new Map(classes.map((c) => [String(c._id), c]));

    const mapped = recordings.map((r) => {
      const classDoc = classMap.get(String(r.classId));
      const gradeDoc = classDoc ? gradeMap.get(String(classDoc.gradeId)) : null;

      return {
        ...r,
        classDetails: buildClassDetails(classDoc, gradeDoc),
      };
    });

    return res.status(200).json({
      message: "All recordings fetched successfully",
      recordings: mapped,
    });
  } catch (err) {
    next(err);
  }
};