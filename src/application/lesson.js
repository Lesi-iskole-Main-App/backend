import mongoose from "mongoose";
import Lesson from "../infastructure/schemas/lesson.js";
import ClassModel from "../infastructure/schemas/class.js";
import Enrollment from "../infastructure/schemas/enrollment.js";
import Grade from "../infastructure/schemas/grade.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const clean = (v) => String(v || "").trim();

const requireApprovedEnrollment = async (studentId, classId) => {
  return Enrollment.findOne({
    studentId,
    classId,
    status: "approved",
    isActive: true,
  }).lean();
};

const buildLessonClassDetails = async (classId) => {
  if (!isValidObjectId(classId)) return null;

  const classDoc = await ClassModel.findById(classId)
    .populate("teacherIds", "name")
    .lean();

  if (!classDoc) return null;

  const gradeDoc = await Grade.findById(classDoc.gradeId).lean();
  if (!gradeDoc) {
    return {
      classId: classDoc._id,
      className: classDoc.className || "—",
      batchNumber: classDoc.batchNumber || "",
      grade: null,
      stream: "",
      subject: "",
    };
  }

  if (gradeDoc.flowType === "normal") {
    const subjectObj = (gradeDoc.subjects || []).find(
      (s) => String(s?._id) === String(classDoc.subjectId)
    );

    return {
      classId: classDoc._id,
      className: classDoc.className || "—",
      batchNumber: classDoc.batchNumber || "",
      grade: gradeDoc.grade || null,
      stream: "",
      subject: subjectObj?.subject || "",
    };
  }

  const streamObj = (gradeDoc.streams || []).find(
    (s) => String(s?._id) === String(classDoc.streamId)
  );

  const subjectObj = (streamObj?.subjects || []).find(
    (s) => String(s?._id) === String(classDoc.streamSubjectId)
  );

  return {
    classId: classDoc._id,
    className: classDoc.className || "—",
    batchNumber: classDoc.batchNumber || "",
    grade: gradeDoc.grade || null,
    stream: streamObj?.stream || "",
    subject: subjectObj?.subject || "",
  };
};

export const createLesson = async (req, res) => {
  try {
    const { classId, title, date, time, description = "", youtubeUrl = "" } =
      req.body || {};

    if (!classId || !title || !date || !time) {
      return res.status(400).json({
        message: "classId, title, date and time are required",
      });
    }

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const foundClass = await ClassModel.findById(classId).lean();
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const lesson = await Lesson.create({
      classId,
      title: clean(title),
      date: clean(date),
      time: clean(time),
      description: clean(description),
      youtubeUrl: clean(youtubeUrl),
      createdBy: req.user?.id || null,
    });

    const classDetails = await buildLessonClassDetails(classId);

    return res.status(201).json({
      message: "Lesson created successfully",
      lesson: {
        ...lesson.toObject(),
        classDetails,
      },
    });
  } catch (err) {
    console.error("createLesson error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({
        message: "Lesson already exists for this class/date/time/title",
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllLessons = async (req, res) => {
  try {
    const lessons = await Lesson.find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    const enriched = [];
    for (const lesson of lessons) {
      const classDetails = await buildLessonClassDetails(lesson.classId);
      enriched.push({
        ...lesson,
        classDetails,
      });
    }

    return res.status(200).json({
      message: "Lessons fetched successfully",
      lessons: enriched,
    });
  } catch (err) {
    console.error("getAllLessons error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getLessonsByClassId = async (req, res) => {
  try {
    const { classId } = req.params;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const foundClass = await ClassModel.findById(classId).lean();
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const lessons = await Lesson.find({
      classId,
      isActive: true,
    })
      .sort({ createdAt: 1 })
      .lean();

    const role = String(req.user?.role || "").toLowerCase();

    if (role === "student") {
      const approved = await requireApprovedEnrollment(req.user?.id, classId);

      if (!approved) {
        return res.status(200).json({
          message: "Demo lesson only",
          lessons: lessons.length > 0 ? [lessons[0]] : [],
          access: "demo",
        });
      }

      return res.status(200).json({
        message: "Lessons fetched successfully",
        lessons,
        access: "full",
      });
    }

    return res.status(200).json({
      message: "Lessons fetched successfully",
      lessons,
      access: "full",
    });
  } catch (err) {
    console.error("getLessonsByClassId error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getLessonById = async (req, res) => {
  try {
    const { lessonId } = req.params;

    if (!isValidObjectId(lessonId)) {
      return res.status(400).json({ message: "Invalid lessonId" });
    }

    const lesson = await Lesson.findById(lessonId).lean();
    if (!lesson || lesson.isActive === false) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    return res.status(200).json({
      message: "Lesson fetched successfully",
      lesson,
    });
  } catch (err) {
    console.error("getLessonById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateLessonById = async (req, res) => {
  try {
    const { lessonId } = req.params;

    if (!isValidObjectId(lessonId)) {
      return res.status(400).json({ message: "Invalid lessonId" });
    }

    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    const { title, date, time, description, youtubeUrl, isActive } =
      req.body || {};

    if (title !== undefined) lesson.title = clean(title);
    if (date !== undefined) lesson.date = clean(date);
    if (time !== undefined) lesson.time = clean(time);
    if (description !== undefined) lesson.description = clean(description);
    if (youtubeUrl !== undefined) lesson.youtubeUrl = clean(youtubeUrl);
    if (isActive !== undefined) lesson.isActive = Boolean(isActive);

    await lesson.save();

    const classDetails = await buildLessonClassDetails(lesson.classId);

    return res.status(200).json({
      message: "Lesson updated successfully",
      lesson: {
        ...lesson.toObject(),
        classDetails,
      },
    });
  } catch (err) {
    console.error("updateLessonById error:", err);
    if (err?.code === 11000) {
      return res.status(409).json({
        message: "Lesson already exists for this class/date/time/title",
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteLessonById = async (req, res) => {
  try {
    const { lessonId } = req.params;

    if (!isValidObjectId(lessonId)) {
      return res.status(400).json({ message: "Invalid lessonId" });
    }

    const deleted = await Lesson.findByIdAndDelete(lessonId);
    if (!deleted) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    return res.status(200).json({
      message: "Lesson deleted successfully",
      lesson: deleted,
    });
  } catch (err) {
    console.error("deleteLessonById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};