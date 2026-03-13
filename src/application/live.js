import mongoose from "mongoose";
import Live from "../infastructure/schemas/live.js";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import Enrollment from "../infastructure/schemas/enrollment.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeZoomLinks = (body = {}) => {
  if (Array.isArray(body.zoomLinks)) {
    const cleaned = body.zoomLinks
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    if (cleaned.length > 0) {
      return cleaned;
    }
  }

  if (body.zoomLink) {
    const single = String(body.zoomLink || "").trim();
    return single ? [single] : [];
  }

  return [];
};

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

const mapLiveForResponse = (liveDoc, classDetails = null) => {
  const live = liveDoc?.toObject ? liveDoc.toObject() : liveDoc;

  const zoomLinks = Array.isArray(live?.zoomLinks)
    ? live.zoomLinks.map((x) => String(x || "").trim()).filter(Boolean)
    : live?.zoomLink
    ? [String(live.zoomLink).trim()].filter(Boolean)
    : [];

  return {
    ...live,
    zoomLinks,
    zoomLink: zoomLinks[0] || "",
    ...(classDetails ? { classDetails } : {}),
  };
};

// CREATE
export const createLiveByClassId = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { title, scheduledAt } = req.body;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const zoomLinks = normalizeZoomLinks(req.body);

    if (!title || !scheduledAt || zoomLinks.length === 0) {
      return res
        .status(400)
        .json({ message: "title, scheduledAt and at least one zoom link are required" });
    }

    const foundClass = await ClassModel.findById(classId);
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const parsedDate = new Date(scheduledAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "Invalid scheduledAt" });
    }

    const live = await Live.create({
      classId,
      title: String(title).trim(),
      scheduledAt: parsedDate,
      zoomLinks,
      zoomLink: zoomLinks[0],
      createdBy: req.user?.id || null,
    });

    return res.status(201).json({
      message: "Live class created successfully",
      live: mapLiveForResponse(live),
    });
  } catch (err) {
    next(err);
  }
};

// GET ALL BY CLASS
export const getAllLiveByClassId = async (req, res, next) => {
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

    const gradeDoc = await Grade.findById(foundClass.gradeId).lean();

    const lives = await Live.find({
      classId,
      isActive: true,
    }).sort({ scheduledAt: 1 });

    const classDetails = buildClassDetails(foundClass, gradeDoc);

    const mapped = lives.map((r) => mapLiveForResponse(r, classDetails));

    return res.status(200).json({
      message: "Live classes fetched successfully",
      lives: mapped,
    });
  } catch (err) {
    next(err);
  }
};

// GET ONE
export const getLiveByClassIdAndLiveId = async (req, res, next) => {
  try {
    const { classId, liveId } = req.params;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!isValidObjectId(liveId)) {
      return res.status(400).json({ message: "Invalid liveId" });
    }

    const foundClass = await ClassModel.findById(classId).populate(
      "teacherIds",
      "name"
    );

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const gradeDoc = await Grade.findById(foundClass.gradeId).lean();

    const live = await Live.findOne({
      _id: liveId,
      classId,
      isActive: true,
    });

    if (!live) {
      return res.status(404).json({ message: "Live class not found" });
    }

    return res.status(200).json({
      message: "Live class fetched successfully",
      live: mapLiveForResponse(live, buildClassDetails(foundClass, gradeDoc)),
    });
  } catch (err) {
    next(err);
  }
};

// UPDATE
export const updateLiveByClassId = async (req, res, next) => {
  try {
    const { classId, liveId } = req.params;
    const { title, scheduledAt, isActive } = req.body;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!isValidObjectId(liveId)) {
      return res.status(400).json({ message: "Invalid liveId" });
    }

    const live = await Live.findOne({
      _id: liveId,
      classId,
    });

    if (!live) {
      return res.status(404).json({ message: "Live class not found" });
    }

    if (title !== undefined) live.title = String(title).trim();

    if (scheduledAt !== undefined) {
      const parsedDate = new Date(scheduledAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid scheduledAt" });
      }
      live.scheduledAt = parsedDate;
    }

    if (req.body.zoomLinks !== undefined || req.body.zoomLink !== undefined) {
      const zoomLinks = normalizeZoomLinks(req.body);
      if (zoomLinks.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one zoom link is required" });
      }
      live.zoomLinks = zoomLinks;
      live.zoomLink = zoomLinks[0];
    }

    if (isActive !== undefined) live.isActive = Boolean(isActive);

    await live.save();

    return res.status(200).json({
      message: "Live class updated successfully",
      live: mapLiveForResponse(live),
    });
  } catch (err) {
    next(err);
  }
};

// DELETE
export const deleteLiveByClassId = async (req, res, next) => {
  try {
    const { classId, liveId } = req.params;

    if (!isValidObjectId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (!isValidObjectId(liveId)) {
      return res.status(400).json({ message: "Invalid liveId" });
    }

    const deleted = await Live.findOneAndDelete({
      _id: liveId,
      classId,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Live class not found" });
    }

    return res.status(200).json({
      message: "Live class deleted successfully",
      live: mapLiveForResponse(deleted),
    });
  } catch (err) {
    next(err);
  }
};

// GET ALL FOR ADMIN/TEACHER TABLE
export const getAllLives = async (req, res, next) => {
  try {
    const lives = await Live.find({ isActive: true })
      .sort({ scheduledAt: 1 })
      .lean();

    const classIds = [...new Set(lives.map((r) => String(r.classId)).filter(Boolean))];

    const classes = await ClassModel.find({ _id: { $in: classIds } })
      .populate("teacherIds", "name")
      .lean();

    const gradeIds = [
      ...new Set(classes.map((c) => String(c.gradeId)).filter(Boolean)),
    ];

    const grades = await Grade.find({ _id: { $in: gradeIds } }).lean();
    const gradeMap = new Map(grades.map((g) => [String(g._id), g]));
    const classMap = new Map(classes.map((c) => [String(c._id), c]));

    const mapped = lives.map((r) => {
      const classDoc = classMap.get(String(r.classId));
      const gradeDoc = classDoc ? gradeMap.get(String(classDoc.gradeId)) : null;
      const classDetails = buildClassDetails(classDoc, gradeDoc);

      return mapLiveForResponse(r, classDetails);
    });

    return res.status(200).json({
      message: "All live classes fetched successfully",
      lives: mapped,
    });
  } catch (err) {
    next(err);
  }
};

// STUDENT: GET ONLY MY APPROVED LIVE CLASSES
export const getStudentLives = async (req, res, next) => {
  try {
    const studentId = req.user?.id;

    if (!studentId || !isValidObjectId(studentId)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const enrollments = await Enrollment.find({
      studentId,
      status: "approved",
      isActive: true,
    })
      .select("classId")
      .lean();

    const classIds = [
      ...new Set(enrollments.map((e) => String(e.classId)).filter(Boolean)),
    ];

    if (classIds.length === 0) {
      return res.status(200).json({ lives: [] });
    }

    const now = Date.now();
    const oneHourBeforeMs = 1 * 60 * 60 * 1000;
    const tenHoursAfterMs = 10 * 60 * 60 * 1000;

    const lives = await Live.find({
      classId: { $in: classIds },
      isActive: true,
    })
      .sort({ scheduledAt: 1 })
      .lean();

    const classes = await ClassModel.find({ _id: { $in: classIds } })
      .populate("teacherIds", "name")
      .lean();

    const gradeIds = [
      ...new Set(classes.map((c) => String(c.gradeId)).filter(Boolean)),
    ];

    const grades = await Grade.find({ _id: { $in: gradeIds } }).lean();
    const gradeMap = new Map(grades.map((g) => [String(g._id), g]));
    const classMap = new Map(classes.map((c) => [String(c._id), c]));

    const filtered = lives.filter((live) => {
      const scheduledMs = new Date(live?.scheduledAt).getTime();
      if (!scheduledMs || Number.isNaN(scheduledMs)) return false;

      const openMs = scheduledMs - oneHourBeforeMs;
      const closeMs = scheduledMs + tenHoursAfterMs;

      return now >= openMs && now <= closeMs;
    });

    const mapped = filtered.map((live) => {
      const classDoc = classMap.get(String(live.classId));
      const gradeDoc = classDoc ? gradeMap.get(String(classDoc.gradeId)) : null;
      const classDetails = buildClassDetails(classDoc, gradeDoc);

      return {
        ...mapLiveForResponse(live, classDetails),
        teacherNames: classDetails.teachers || [],
      };
    });

    return res.status(200).json({
      lives: mapped,
    });
  } catch (err) {
    next(err);
  }
};