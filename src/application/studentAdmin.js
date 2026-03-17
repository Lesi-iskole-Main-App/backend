import mongoose from "mongoose";
import User, { DISTRICT_ENUMS } from "../infastructure/schemas/user.js";
import Grade from "../infastructure/schemas/grade.js";
import ClassModel from "../infastructure/schemas/class.js";
import Enrollment from "../infastructure/schemas/enrollment.js";

const toId = (value) => String(value || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))];
};

const streamLabelMap = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getStatusFromProgressDate = (progressUpdatedAt) => {
  if (!progressUpdatedAt) return "inactive";

  const last = new Date(progressUpdatedAt);
  if (Number.isNaN(last.getTime())) return "inactive";

  const now = Date.now();
  const diffMs = now - last.getTime();
  const days30 = 30 * 24 * 60 * 60 * 1000;

  return diffMs <= days30 ? "active" : "inactive";
};

const getLevelFromGradeNumber = (gradeNumber) => {
  const grade = Number(gradeNumber || 0);

  if (grade >= 1 && grade <= 5) return "primary";
  if (grade >= 6 && grade <= 11) return "secondary";
  if (grade >= 12 && grade <= 13) return "al";

  return "";
};

const buildClassMetaMap = async (classDocs = []) => {
  const gradeIds = uniqueValues(classDocs.map((c) => c.gradeId));

  const gradeDocs = gradeIds.length
    ? await Grade.find({ _id: { $in: gradeIds } })
        .select("_id grade flowType subjects streams")
        .lean()
    : [];

  const gradeMap = new Map(gradeDocs.map((g) => [toId(g._id), g]));
  const classMap = new Map();

  for (const c of classDocs) {
    const gradeDoc = gradeMap.get(toId(c.gradeId));
    const flowType = String(gradeDoc?.flowType || "normal");
    const grade = Number(gradeDoc?.grade || 0) || null;

    let subject = "";
    let stream = "";
    let streamLabel = "";

    if (flowType === "normal") {
      const subjectDoc = (gradeDoc?.subjects || []).find(
        (s) => toId(s._id) === toId(c.subjectId)
      );
      subject = String(subjectDoc?.subject || "").trim();
    } else {
      const streamDoc = (gradeDoc?.streams || []).find(
        (s) => toId(s._id) === toId(c.streamId)
      );
      stream = String(streamDoc?.stream || "").trim();
      streamLabel = streamLabelMap[stream] || stream;

      const subjectDoc = (streamDoc?.subjects || []).find(
        (s) => toId(s._id) === toId(c.streamSubjectId)
      );
      subject = String(subjectDoc?.subject || "").trim();
    }

    classMap.set(toId(c._id), {
      classId: toId(c._id),
      id: toId(c._id),
      className: String(c.className || "").trim(),
      batchNumber: String(c.batchNumber || "").trim(),
      flowType,
      grade,
      level: getLevelFromGradeNumber(grade),
      subject,
      stream,
      streamLabel,
    });
  }

  return classMap;
};

export const getStudentOptions = async (req, res, next) => {
  try {
    const gradeDocs = await Grade.find({ isActive: true })
      .select("grade flowType")
      .sort({ grade: 1 })
      .lean();

    const classDocs = await ClassModel.find({ isActive: true })
      .select("_id className batchNumber gradeId subjectId streamId streamSubjectId")
      .sort({ className: 1, batchNumber: 1, createdAt: -1 })
      .lean();

    const classMap = await buildClassMetaMap(classDocs);
    const classes = Array.from(classMap.values());

    return res.status(200).json({
      districts: DISTRICT_ENUMS,
      levels: ["primary", "secondary", "al"],
      grades: gradeDocs.map((g) => ({
        grade: Number(g.grade),
        level: getLevelFromGradeNumber(g.grade),
        flowType: String(g.flowType || "normal"),
      })),
      batchNumbers: uniqueValues(classDocs.map((c) => c.batchNumber)).sort(
        (a, b) =>
          String(a).localeCompare(String(b), undefined, {
            numeric: true,
          })
      ),
      classes,
    });
  } catch (err) {
    console.error("getStudentOptions error:", err);
    next(err);
  }
};

export const getStudents = async (req, res, next) => {
  try {
    const {
      status = "",
      phonenumber = "",
      district = "",
      level = "",
      grade = "",
      classId = "",
      batchNumber = "",
      page = "1",
      limit = "20",
    } = req.query;

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNumber - 1) * limitNumber;

    const userQuery = { role: "student" };

    if (phonenumber) {
      userQuery.phonenumber = {
        $regex: escapeRegex(String(phonenumber).trim()),
        $options: "i",
      };
    }

    if (district) {
      userQuery.district = String(district).trim();
    }

    if (level) {
      userQuery.selectedLevel = String(level).trim();
    }

    if (grade) {
      userQuery.selectedGradeNumber = Number(grade);
    }

    const students = await User.find(userQuery)
      .select(
        "name phonenumber district town address selectedLevel selectedGradeNumber selectedStream progressUpdatedAt isActive"
      )
      .sort({ createdAt: -1 })
      .lean();

    if (!students.length) {
      return res.status(200).json({
        total: 0,
        page: pageNumber,
        limit: limitNumber,
        rows: [],
      });
    }

    const studentIds = students.map((s) => s._id);

    const enrollments = await Enrollment.find({
      studentId: { $in: studentIds },
      status: "approved",
      isActive: true,
    })
      .select("studentId classId")
      .lean();

    const enrolledClassIds = uniqueValues(enrollments.map((e) => e.classId));
    const classDocs = enrolledClassIds.length
      ? await ClassModel.find({
          _id: { $in: enrolledClassIds },
        })
          .select("_id className batchNumber gradeId subjectId streamId streamSubjectId")
          .lean()
      : [];

    const classMap = await buildClassMetaMap(classDocs);

    const accessesByStudentId = new Map();

    for (const enrollment of enrollments) {
      const studentKey = toId(enrollment.studentId);
      const classInfo = classMap.get(toId(enrollment.classId));
      if (!classInfo) continue;

      if (!accessesByStudentId.has(studentKey)) {
        accessesByStudentId.set(studentKey, []);
      }

      accessesByStudentId.get(studentKey).push(classInfo);
    }

    let rows = students.map((student) => {
      const accesses = accessesByStudentId.get(toId(student._id)) || [];
      const batchNumbers = uniqueValues(accesses.map((a) => a.batchNumber));
      const classNames = uniqueValues(accesses.map((a) => a.className));
      const statusKey = getStatusFromProgressDate(student.progressUpdatedAt);

      return {
        _id: toId(student._id),
        name: String(student.name || "").trim(),
        phonenumber: String(student.phonenumber || "").trim(),
        district: String(student.district || "").trim(),
        town: String(student.town || "").trim(),
        address: String(student.address || "").trim(),
        selectedLevel: String(student.selectedLevel || "").trim(),
        selectedGradeNumber: Number(student.selectedGradeNumber || 0) || null,
        selectedStream: String(student.selectedStream || "").trim(),
        batchNumbers,
        classNames,
        accesses,
        statusKey,
        isActive: Boolean(student.isActive),
      };
    });

    if (status) {
      const wanted = String(status).trim().toLowerCase();
      rows = rows.filter(
        (row) => String(row.statusKey).toLowerCase() === wanted
      );
    }

    if (batchNumber) {
      const wanted = String(batchNumber).trim();
      rows = rows.filter((row) => (row.batchNumbers || []).includes(wanted));
    }

    if (classId) {
      const wantedClassId = toId(classId);
      rows = rows.filter((row) =>
        (row.accesses || []).some((a) => toId(a.classId) === wantedClassId)
      );
    }

    const total = rows.length;
    const pagedRows = rows.slice(skip, skip + limitNumber);

    return res.status(200).json({
      total,
      page: pageNumber,
      limit: limitNumber,
      rows: pagedRows,
    });
  } catch (err) {
    console.error("getStudents error:", err);
    next(err);
  }
};

export const grantStudentAccess = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { classId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: "Invalid class id" });
    }

    const student = await User.findOne({
      _id: id,
      role: "student",
    }).select("_id name phonenumber");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const classDoc = await ClassModel.findOne({
      _id: classId,
      isActive: true,
    }).select("_id className batchNumber");

    if (!classDoc) {
      return res.status(404).json({ message: "Class not found" });
    }

    const existing = await Enrollment.findOne({
      studentId: id,
      classId,
    });

    if (existing) {
      existing.studentName = String(existing.studentName || student.name || "").trim();
      existing.studentPhone = String(
        existing.studentPhone || student.phonenumber || ""
      ).trim();
      existing.status = "approved";
      existing.isActive = true;
      existing.approvedAt = new Date();
      existing.approvedBy = req.user?.id || null;
      await existing.save();
    } else {
      await Enrollment.create({
        studentId: id,
        classId,
        studentName: String(student.name || "").trim(),
        studentPhone: String(student.phonenumber || "").trim(),
        status: "approved",
        requestedAt: new Date(),
        approvedAt: new Date(),
        approvedBy: req.user?.id || null,
        isActive: true,
      });
    }

    return res.status(200).json({
      message: "Class access granted successfully",
      studentId: toId(id),
      classId: toId(classId),
      className: String(classDoc.className || "").trim(),
      batchNumber: String(classDoc.batchNumber || "").trim(),
    });
  } catch (err) {
    console.error("grantStudentAccess error:", err);
    next(err);
  }
};

export const removeStudentAccess = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { classId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid student id" });
    }

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: "Invalid class id" });
    }

    const existing = await Enrollment.findOne({
      studentId: id,
      classId,
      status: "approved",
      isActive: true,
    });

    if (!existing) {
      return res.status(404).json({ message: "Active access not found" });
    }

    existing.isActive = false;
    await existing.save();

    return res.status(200).json({
      message: "Class access removed successfully",
      studentId: toId(id),
      classId: toId(classId),
    });
  } catch (err) {
    console.error("removeStudentAccess error:", err);
    next(err);
  }
};

export const bulkRemoveClassAccess = async (req, res, next) => {
  try {
    const { classId } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: "Invalid class id" });
    }

    const classDoc = await ClassModel.findById(classId)
      .select("_id className batchNumber")
      .lean();

    if (!classDoc) {
      return res.status(404).json({ message: "Class not found" });
    }

    const result = await Enrollment.updateMany(
      {
        classId,
        status: "approved",
        isActive: true,
      },
      {
        $set: { isActive: false },
      }
    );

    return res.status(200).json({
      message: "Access removed for all students in selected class",
      classId: toId(classId),
      className: String(classDoc.className || "").trim(),
      batchNumber: String(classDoc.batchNumber || "").trim(),
      removedCount: Number(result?.modifiedCount || 0),
    });
  } catch (err) {
    console.error("bulkRemoveClassAccess error:", err);
    next(err);
  }
};

export const banStudent = async (req, res, next) => {
  try {
    const { id } = req.params;

    const student = await User.findOneAndUpdate(
      { _id: id, role: "student" },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    return res.status(200).json({
      message: "Student banned successfully",
      id: toId(student._id),
      isActive: false,
    });
  } catch (err) {
    console.error("banStudent error:", err);
    next(err);
  }
};

export const unbanStudent = async (req, res, next) => {
  try {
    const { id } = req.params;

    const student = await User.findOneAndUpdate(
      { _id: id, role: "student" },
      { $set: { isActive: true } },
      { new: true }
    ).lean();

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    return res.status(200).json({
      message: "Student unbanned successfully",
      id: toId(student._id),
      isActive: true,
    });
  } catch (err) {
    console.error("unbanStudent error:", err);
    next(err);
  }
};