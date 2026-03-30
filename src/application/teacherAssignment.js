import mongoose from "mongoose";
import User from "../infastructure/schemas/user.js";
import ClassModel from "../infastructure/schemas/class.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const getStreamLabel = (value = "") => {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return AL_STREAM_LABELS[key] || value || "";
};

const safeTeacher = (u) => ({
  _id: u._id,
  name: u.name || "",
  email: u.email || "",
  whatsapp: u.phonenumber || "",
  phonenumber: u.phonenumber || "",
  role: u.role,
  isVerified: u.isVerified,
  isApproved: u.isApproved,
  approvedAt: u.approvedAt,
  approvedBy: u.approvedBy,
  isActive: u.isActive,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const buildClassSummary = (doc) => {
  const grade = doc?.gradeId;

  if (!grade) {
    return {
      _id: doc?._id,
      className: doc?.className || "",
      batchNumber: doc?.batchNumber || "",
      grade: null,
      gradeLabel: "",
      stream: "",
      streamNames: [],
      subjectName: "",
      isActive: !!doc?.isActive,
      teacherCount: Array.isArray(doc?.teacherIds) ? doc.teacherIds.length : 0,
      createdAt: doc?.createdAt,
      updatedAt: doc?.updatedAt,
    };
  }

  if (grade.flowType === "normal") {
    const subjectObj = (grade.subjects || []).find(
      (s) => String(s._id) === String(doc.subjectId)
    );

    return {
      _id: doc._id,
      className: doc.className || "",
      batchNumber: doc.batchNumber || "",
      grade: grade.grade,
      gradeLabel: `Grade ${grade.grade}`,
      stream: "",
      streamNames: [],
      subjectName: subjectObj?.subject || "",
      isActive: !!doc.isActive,
      teacherCount: Array.isArray(doc.teacherIds) ? doc.teacherIds.length : 0,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  const streamIds = Array.isArray(doc?.streamIds)
    ? doc.streamIds.map((x) => String(x))
    : [];

  const streamNames = (grade.streams || [])
    .filter((s) => streamIds.includes(String(s._id)))
    .map((s) => getStreamLabel(s?.stream));

  return {
    _id: doc._id,
    className: doc.className || "",
    batchNumber: doc.batchNumber || "",
    grade: 12,
    gradeLabel: "A/L",
    stream: streamNames.join(", "),
    streamNames,
    subjectName: doc.alSubjectName || "",
    isActive: !!doc.isActive,
    teacherCount: Array.isArray(doc.teacherIds) ? doc.teacherIds.length : 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const buildReadableAssignmentsFromClasses = (classes = []) => {
  const map = new Map();

  for (const cls of classes) {
    const gradeLabel = cls.gradeLabel || "";
    const stream = cls.stream || "";
    const key = `${gradeLabel}__${stream}`;

    if (!map.has(key)) {
      map.set(key, {
        grade: cls.grade || null,
        gradeLabel,
        stream,
        subjects: [],
        classes: [],
      });
    }

    const bucket = map.get(key);

    if (
      cls.subjectName &&
      !bucket.subjects.some(
        (s) => String(s.subject || "").trim() === String(cls.subjectName).trim()
      )
    ) {
      bucket.subjects.push({
        subject: cls.subjectName,
      });
    }

    bucket.classes.push({
      _id: cls._id,
      className: cls.className,
      batchNumber: cls.batchNumber,
      subjectName: cls.subjectName,
      gradeLabel: cls.gradeLabel,
      stream: cls.stream,
    });

    map.set(key, bucket);
  }

  return Array.from(map.values()).sort((a, b) => {
    const ag = Number(a.grade || 0);
    const bg = Number(b.grade || 0);
    if (ag !== bg) return ag - bg;
    return String(a.stream || "").localeCompare(String(b.stream || ""));
  });
};

const getAssignedClassesForTeacher = async (teacherId) => {
  const list = await ClassModel.find({ teacherIds: teacherId })
    .populate("gradeId", "grade flowType title subjects streams")
    .sort({ createdAt: -1 })
    .lean();

  return list.map(buildClassSummary);
};

const getAvailableClasses = async () => {
  const list = await ClassModel.find({ isActive: true })
    .populate("gradeId", "grade flowType title subjects streams")
    .sort({ createdAt: -1 })
    .lean();

  return list.map(buildClassSummary);
};

const validateClassIds = async (classIds = []) => {
  for (const classId of classIds) {
    if (!isValidId(classId)) {
      return { ok: false, message: `Invalid classId: ${classId}` };
    }

    const cls = await ClassModel.findById(classId).lean();
    if (!cls) {
      return { ok: false, message: `Class not found: ${classId}` };
    }
  }

  return { ok: true };
};

// =======================================================
// GET TEACHERS
// =======================================================
export const getAllTeachers = async (req, res) => {
  try {
    const { status = "all" } = req.query;

    const filter = { role: "teacher" };
    if (status === "pending") filter.isApproved = false;
    if (status === "approved") filter.isApproved = true;

    const teachers = await User.find(filter).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      teachers: teachers.map(safeTeacher),
    });
  } catch (err) {
    console.error("getAllTeachers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// GET TEACHER BY ID
// =======================================================
export const getTeacherById = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    const teacher = await User.findById(teacherId).lean();

    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const assignedClasses = await getAssignedClassesForTeacher(teacherId);
    const readableAssignments =
      buildReadableAssignmentsFromClasses(assignedClasses);

    return res.status(200).json({
      teacher: safeTeacher(teacher),
      assignedClasses,
      readableAssignments,
    });
  } catch (err) {
    console.error("getTeacherById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// UPDATE TEACHER BASIC INFO
// =======================================================
export const updateTeacherById = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { name, email, whatsapp, isApproved } = req.body || {};

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    if (name !== undefined) teacher.name = String(name || "").trim();
    if (email !== undefined) teacher.email = String(email || "").trim();
    if (whatsapp !== undefined) teacher.phonenumber = String(whatsapp || "").trim();

    if (typeof isApproved === "boolean") {
      teacher.isApproved = isApproved;
      teacher.approvedAt = isApproved ? new Date() : null;
      teacher.approvedBy = isApproved ? req.user?.id || null : null;
    }

    await teacher.save();

    return res.status(200).json({
      message: "Teacher updated",
      teacher: safeTeacher(teacher),
    });
  } catch (err) {
    console.error("updateTeacherById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// DELETE TEACHER (KEEP IF NEEDED LATER, ROUTE NOT USED)
// =======================================================
export const deleteTeacherById = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    await ClassModel.updateMany(
      { teacherIds: teacherId },
      { $pull: { teacherIds: teacherId } }
    );

    await User.findByIdAndDelete(teacherId);

    return res.status(200).json({
      message: "Teacher deleted and removed from classes",
    });
  } catch (err) {
    console.error("deleteTeacherById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// APPROVE / UNAPPROVE
// =======================================================
export const approveTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { isApproved } = req.body || {};

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    if (typeof isApproved !== "boolean") {
      return res.status(400).json({
        message: "isApproved is required",
        example: { isApproved: true },
      });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    teacher.isApproved = isApproved;
    teacher.approvedAt = isApproved ? new Date() : null;
    teacher.approvedBy = isApproved ? req.user?.id || null : null;

    await teacher.save();

    return res.status(200).json({
      message: "Teacher approval updated",
      teacher: safeTeacher(teacher),
    });
  } catch (err) {
    console.error("approveTeacher error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// FORM DATA FOR ASSIGNMENT PAGE
// =======================================================
export const getTeacherAssignFormData = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    const teacher = await User.findById(teacherId).lean();
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const availableClasses = await getAvailableClasses();
    const assignedClasses = await getAssignedClassesForTeacher(teacherId);
    const readableAssignments =
      buildReadableAssignmentsFromClasses(assignedClasses);

    return res.status(200).json({
      teacher: safeTeacher(teacher),
      availableClasses,
      assignedClasses,
      readableAssignments,
    });
  } catch (err) {
    console.error("getTeacherAssignFormData error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// APPEND CLASSES TO TEACHER
// =======================================================
export const createAssignTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { classIds } = req.body || {};

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    if (!Array.isArray(classIds) || classIds.length === 0) {
      return res.status(400).json({ message: "classIds array is required" });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    if (!teacher.isApproved) {
      return res.status(403).json({
        message: "Teacher must be approved before assigning classes",
      });
    }

    const check = await validateClassIds(classIds);
    if (!check.ok) {
      return res.status(400).json({ message: check.message });
    }

    await ClassModel.updateMany(
      { _id: { $in: classIds } },
      { $addToSet: { teacherIds: teacher._id } }
    );

    const assignedClasses = await getAssignedClassesForTeacher(teacherId);
    const readableAssignments =
      buildReadableAssignmentsFromClasses(assignedClasses);

    return res.status(200).json({
      message: "Teacher classes assigned successfully",
      teacher: safeTeacher(teacher),
      assignedClasses,
      readableAssignments,
    });
  } catch (err) {
    console.error("createAssignTeacher error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// REPLACE ALL CLASSES FOR TEACHER (EDIT MODE)
// =======================================================
export const replaceTeacherAssignments = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { classIds } = req.body || {};

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    if (!Array.isArray(classIds)) {
      return res.status(400).json({ message: "classIds array is required" });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    if (!teacher.isApproved) {
      return res.status(403).json({
        message: "Teacher must be approved before assigning classes",
      });
    }

    const check = await validateClassIds(classIds);
    if (!check.ok) {
      return res.status(400).json({ message: check.message });
    }

    const nextIds = classIds.map((x) => new mongoose.Types.ObjectId(String(x)));

    await ClassModel.updateMany(
      { teacherIds: teacher._id, _id: { $nin: nextIds } },
      { $pull: { teacherIds: teacher._id } }
    );

    if (nextIds.length > 0) {
      await ClassModel.updateMany(
        { _id: { $in: nextIds } },
        { $addToSet: { teacherIds: teacher._id } }
      );
    }

    const assignedClasses = await getAssignedClassesForTeacher(teacherId);
    const readableAssignments =
      buildReadableAssignmentsFromClasses(assignedClasses);

    return res.status(200).json({
      message: "Teacher class assignments updated successfully",
      teacher: safeTeacher(teacher),
      assignedClasses,
      readableAssignments,
    });
  } catch (err) {
    console.error("replaceTeacherAssignments error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// =======================================================
// ENABLE / DISABLE TEACHER ACCESS
// =======================================================
export const disableTeacherAccess = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { isActive } = req.body || {};

    if (!isValidId(teacherId)) {
      return res.status(400).json({ message: "Invalid teacherId" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "isActive must be boolean",
        example: { isActive: false },
      });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    teacher.isActive = isActive;
    await teacher.save();

    return res.status(200).json({
      message: "Teacher access updated",
      teacher: safeTeacher(teacher),
    });
  } catch (err) {
    console.error("disableTeacherAccess error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};