import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import User from "../infastructure/schemas/user.js";
import Lesson from "../infastructure/schemas/lesson.js";
import Live from "../infastructure/schemas/live.js";

const toId = (v) => String(v || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))];
};

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const normalizeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const getStreamLabel = (value = "") => {
  const key = normalizeKey(value);
  return AL_STREAM_LABELS[key] || value || "";
};

const getGradeLabel = (gradeDoc) => {
  if (!gradeDoc) return "-";
  if (gradeDoc.flowType === "al") return "A/L";
  return `Grade ${String(gradeDoc.grade).padStart(2, "0")}`;
};

const getNormalSubjectName = (gradeDoc, subjectId) => {
  if (!gradeDoc || !subjectId) return "";

  const subjects = Array.isArray(gradeDoc.subjects) ? gradeDoc.subjects : [];
  const found = subjects.find((s) => toId(s?._id) === toId(subjectId));

  return String(found?.subject || "").trim();
};

const getALSubjectDisplay = (gradeDoc, classDoc) => {
  if (!gradeDoc || !classDoc) return "";

  if (classDoc.streamId && classDoc.streamSubjectId) {
    const streamDoc = (gradeDoc.streams || []).find(
      (s) => toId(s?._id) === toId(classDoc.streamId)
    );

    const subjectDoc = (streamDoc?.subjects || []).find(
      (s) => toId(s?._id) === toId(classDoc.streamSubjectId)
    );

    const streamLabel = getStreamLabel(streamDoc?.stream || "");
    const subjectName = String(subjectDoc?.subject || "").trim();

    return [streamLabel, subjectName].filter(Boolean).join(" - ");
  }

  if (classDoc.alSubjectName) {
    const streamNames = Array.isArray(classDoc.streamIds)
      ? (gradeDoc.streams || [])
          .filter((s) => classDoc.streamIds.map((x) => toId(x)).includes(toId(s._id)))
          .map((s) => getStreamLabel(s.stream))
      : [];

    if (streamNames.length) {
      return `${streamNames.join(", ")} - ${String(classDoc.alSubjectName || "").trim()}`;
    }

    return String(classDoc.alSubjectName || "").trim();
  }

  return "";
};

export const getTeachersAssignedClassReport = async (req, res, next) => {
  try {
    const teacherId = toId(req.user?.id);
    if (!teacherId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const teacher = await User.findById(teacherId)
      .select("_id role isApproved isActive")
      .lean();

    if (!teacher || teacher.role !== "teacher") {
      return res.status(403).json({ message: "Teacher access only" });
    }

    if (teacher.isApproved === false) {
      return res.status(403).json({ message: "Teacher not approved yet" });
    }

    if (teacher.isActive === false) {
      return res.status(403).json({ message: "Teacher account disabled" });
    }

    const page = Math.max(Number(req.query?.page || 1), 1);
    const limit = Math.max(Number(req.query?.limit || 20), 1);
    const skip = (page - 1) * limit;

    const queryClassName = String(req.query?.className || "").trim().toLowerCase();
    const queryGrade = String(req.query?.grade || "").trim().toLowerCase();
    const querySubject = String(req.query?.subject || "").trim().toLowerCase();

    const teacherClasses = await ClassModel.find({
      teacherIds: teacherId,
      isActive: true,
    }).lean();

    if (!teacherClasses.length) {
      return res.status(200).json({
        message: "No classes found for teacher",
        total: 0,
        page,
        limit,
        filters: {
          grades: [],
          subjects: [],
        },
        reports: [],
      });
    }

    const gradeIds = uniqueValues(teacherClasses.map((c) => c?.gradeId));

    const gradeDocs = await Grade.find({
      _id: { $in: gradeIds },
      isActive: true,
    }).lean();

    const gradeMap = new Map(gradeDocs.map((g) => [toId(g._id), g]));

    const classIds = teacherClasses.map((c) => c._id);

    const [lessonCountsRaw, liveCountsRaw] = await Promise.all([
      Lesson.aggregate([
        {
          $match: {
            classId: { $in: classIds },
          },
        },
        {
          $group: {
            _id: "$classId",
            count: { $sum: 1 },
          },
        },
      ]),
      Live.aggregate([
        {
          $match: {
            classId: { $in: classIds },
          },
        },
        {
          $group: {
            _id: "$classId",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const lessonCountMap = new Map(
      (lessonCountsRaw || []).map((x) => [toId(x._id), Number(x.count || 0)])
    );

    const liveCountMap = new Map(
      (liveCountsRaw || []).map((x) => [toId(x._id), Number(x.count || 0)])
    );

    const gradeOptions = uniqueValues(
      teacherClasses.map((cls) => {
        const gradeDoc = gradeMap.get(toId(cls.gradeId));
        return getGradeLabel(gradeDoc);
      })
    ).sort((a, b) => a.localeCompare(b));

    const subjectOptions = uniqueValues(
      teacherClasses.map((cls) => {
        const gradeDoc = gradeMap.get(toId(cls.gradeId));
        if (!gradeDoc) return "";

        if (gradeDoc.flowType === "normal") {
          return getNormalSubjectName(gradeDoc, cls.subjectId);
        }

        return getALSubjectDisplay(gradeDoc, cls);
      })
    ).sort((a, b) => a.localeCompare(b));

    let reports = teacherClasses.map((cls) => {
      const gradeDoc = gradeMap.get(toId(cls.gradeId));

      const gradeLabel = getGradeLabel(gradeDoc);

      let subjectLabel = "-";
      if (gradeDoc?.flowType === "normal") {
        subjectLabel = getNormalSubjectName(gradeDoc, cls.subjectId) || "-";
      } else if (gradeDoc?.flowType === "al") {
        subjectLabel = getALSubjectDisplay(gradeDoc, cls) || "-";
      }

      return {
        id: toId(cls._id),
        className: String(cls.className || "").trim() || "-",
        grade: gradeLabel,
        subject: subjectLabel,
        enrollStudentCount: Number(cls.enrollStudentCount || 0),
        createdAt: cls.createdAt || null,
        lessonCount: lessonCountMap.get(toId(cls._id)) || 0,
        liveClassCount: liveCountMap.get(toId(cls._id)) || 0,
      };
    });

    if (queryClassName) {
      reports = reports.filter((r) =>
        String(r.className || "").toLowerCase().includes(queryClassName)
      );
    }

    if (queryGrade) {
      reports = reports.filter(
        (r) => String(r.grade || "").trim().toLowerCase() === queryGrade
      );
    }

    if (querySubject) {
      reports = reports.filter(
        (r) => String(r.subject || "").trim().toLowerCase() === querySubject
      );
    }

    reports.sort((a, b) =>
      String(a.className || "").localeCompare(String(b.className || ""))
    );

    const total = reports.length;
    const paginatedReports = reports.slice(skip, skip + limit);

    return res.status(200).json({
      message: "Teachers assigned class report fetched successfully",
      total,
      page,
      limit,
      filters: {
        grades: gradeOptions,
        subjects: subjectOptions,
      },
      reports: paginatedReports,
    });
  } catch (err) {
    console.error("getTeachersAssignedClassReport error:", err);
    next(err);
  }
};