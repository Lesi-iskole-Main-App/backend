import User from "../infastructure/schemas/user.js";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import Enrollment from "../infastructure/schemas/enrollment.js";

const toId = (value) => String(value || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))];
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const getStreamLabel = (value = "") => {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return AL_STREAM_LABELS[key] || value || "";
};

const getGradeLabel = (gradeDoc) => {
  if (!gradeDoc) return "";
  if (gradeDoc.flowType === "al") return "A/L";
  return `Grade ${gradeDoc.grade}`;
};

const buildAssignedClassMetaMap = async (classDocs = []) => {
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
    if (!gradeDoc) continue;

    let grade = gradeDoc.flowType === "al" ? 12 : Number(gradeDoc.grade || 0);
    let gradeLabel = getGradeLabel(gradeDoc);
    let subject = "";
    let stream = "";

    if (gradeDoc.flowType === "normal") {
      const subjectDoc = (gradeDoc.subjects || []).find(
        (s) => toId(s._id) === toId(c.subjectId)
      );
      subject = String(subjectDoc?.subject || "").trim();
    } else {
      const streamIds = Array.isArray(c.streamIds)
        ? c.streamIds.map((x) => toId(x))
        : [];

      const streamNames = (gradeDoc.streams || [])
        .filter((s) => streamIds.includes(toId(s._id)))
        .map((s) => getStreamLabel(s?.stream));

      if (streamNames.length) {
        stream = streamNames.join(", ");
      } else if (c.streamId) {
        const legacyStream = (gradeDoc.streams || []).find(
          (s) => toId(s._id) === toId(c.streamId)
        );
        stream = getStreamLabel(legacyStream?.stream || "");
      }

      if (c.alSubjectName) {
        subject = String(c.alSubjectName || "").trim();
      } else if (c.streamId && c.streamSubjectId) {
        const legacyStream = (gradeDoc.streams || []).find(
          (s) => toId(s._id) === toId(c.streamId)
        );
        const legacySubject = (legacyStream?.subjects || []).find(
          (s) => toId(s._id) === toId(c.streamSubjectId)
        );
        subject = String(legacySubject?.subject || "").trim();
      }
    }

    classMap.set(toId(c._id), {
      _id: toId(c._id),
      className: String(c.className || "").trim(),
      batchNumber: String(c.batchNumber || "").trim(),
      grade,
      gradeLabel,
      subject,
      stream,
      flowType: String(gradeDoc.flowType || "normal"),
      subjectDisplay:
        gradeDoc.flowType === "al"
          ? [stream, subject].filter(Boolean).join(" - ")
          : subject,
    });
  }

  return classMap;
};

export const getTeacherEnrollSubjectStudents = async (req, res, next) => {
  try {
    const teacherId = req.user?.id;

    if (!teacherId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const teacher = await User.findById(teacherId)
      .select("_id role isApproved isActive name")
      .lean();

    if (!teacher || teacher.role !== "teacher") {
      return res.status(403).json({ message: "Teacher access only" });
    }

    if (!teacher.isApproved) {
      return res.status(403).json({ message: "Teacher not approved yet" });
    }

    if (teacher.isActive === false) {
      return res.status(403).json({ message: "Teacher account is disabled" });
    }

    const {
      classId = "",
      studentName = "",
      grade = "",
      subject = "",
      page = "1",
      limit = "20",
    } = req.query || {};

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.max(1, Math.min(100, Number(limit) || 20));

    const assignedClasses = await ClassModel.find({
      teacherIds: teacherId,
      isActive: true,
    })
      .select(
        "_id className batchNumber gradeId subjectId streamId streamSubjectId alSubjectName streamIds isActive"
      )
      .sort({ className: 1, batchNumber: 1, createdAt: -1 })
      .lean();

    if (!assignedClasses.length) {
      return res.status(200).json({
        students: [],
        total: 0,
        page: pageNumber,
        limit: limitNumber,
        totalPages: 1,
        filters: {
          classNames: [],
          grades: [],
          subjects: [],
        },
      });
    }

    const classMetaMap = await buildAssignedClassMetaMap(assignedClasses);
    const assignedClassIds = Array.from(classMetaMap.keys());

    let filteredClassIds = [...assignedClassIds];

    if (classId) {
      const wantedClassId = toId(classId);
      filteredClassIds = filteredClassIds.filter((id) => id === wantedClassId);
    }

    if (grade) {
      const wantedGrade = String(grade).trim().toLowerCase();
      filteredClassIds = filteredClassIds.filter((id) => {
        const cls = classMetaMap.get(id);
        if (!cls) return false;

        const gradeText = String(cls.gradeLabel || "").trim().toLowerCase();
        const gradeNum = String(cls.grade || "").trim().toLowerCase();

        return gradeText === wantedGrade || gradeNum === wantedGrade;
      });
    }

    if (subject) {
      const wantedSubject = String(subject).trim().toLowerCase();
      filteredClassIds = filteredClassIds.filter((id) => {
        const cls = classMetaMap.get(id);
        if (!cls) return false;

        return (
          String(cls.subject || "").trim().toLowerCase() === wantedSubject ||
          String(cls.subjectDisplay || "").trim().toLowerCase() === wantedSubject
        );
      });
    }

    const allClassOptions = assignedClassIds
      .map((id) => classMetaMap.get(id))
      .filter(Boolean)
      .map((cls) => ({
        value: cls._id,
        label: `${cls.className}${
          cls.batchNumber ? ` - Batch ${cls.batchNumber}` : ""
        }`,
      }));

    const allGradeOptions = uniqueValues(
      assignedClassIds
        .map((id) => classMetaMap.get(id)?.gradeLabel)
        .filter(Boolean)
    ).map((g) => ({ value: g, label: g }));

    const allSubjectOptions = uniqueValues(
      assignedClassIds
        .map((id) => classMetaMap.get(id)?.subjectDisplay)
        .filter(Boolean)
    ).map((s) => ({ value: s, label: s }));

    if (!filteredClassIds.length) {
      return res.status(200).json({
        students: [],
        total: 0,
        page: pageNumber,
        limit: limitNumber,
        totalPages: 1,
        filters: {
          classNames: allClassOptions,
          grades: allGradeOptions,
          subjects: allSubjectOptions,
        },
      });
    }

    const enrollments = await Enrollment.find({
      classId: { $in: filteredClassIds },
      status: "approved",
      isActive: true,
    })
      .select("studentId classId studentName studentPhone")
      .lean();

    if (!enrollments.length) {
      return res.status(200).json({
        students: [],
        total: 0,
        page: pageNumber,
        limit: limitNumber,
        totalPages: 1,
        filters: {
          classNames: allClassOptions,
          grades: allGradeOptions,
          subjects: allSubjectOptions,
        },
      });
    }

    const studentIds = uniqueValues(enrollments.map((e) => e.studentId));

    const studentQuery = {
      _id: { $in: studentIds },
      role: "student",
    };

    if (studentName) {
      studentQuery.name = {
        $regex: escapeRegex(String(studentName).trim()),
        $options: "i",
      };
    }

    const studentDocs = await User.find(studentQuery)
      .select("_id name district town")
      .sort({ name: 1 })
      .lean();

    const studentMap = new Map(studentDocs.map((s) => [toId(s._id), s]));
    const grouped = new Map();

    for (const enr of enrollments) {
      const student = studentMap.get(toId(enr.studentId));
      const cls = classMetaMap.get(toId(enr.classId));

      if (!student || !cls) continue;

      const key = toId(student._id);

      if (!grouped.has(key)) {
        grouped.set(key, {
          id: toId(student._id),
          studentName: String(student.name || enr.studentName || "").trim(),
          district: String(student.district || "").trim(),
          classNames: [],
          subjects: [],
          grades: [],
        });
      }

      const bucket = grouped.get(key);

      const classLabel = `${cls.className}${
        cls.batchNumber ? ` - Batch ${cls.batchNumber}` : ""
      }`;

      if (!bucket.classNames.includes(classLabel)) {
        bucket.classNames.push(classLabel);
      }

      if (cls.subjectDisplay && !bucket.subjects.includes(cls.subjectDisplay)) {
        bucket.subjects.push(cls.subjectDisplay);
      }

      if (cls.gradeLabel && !bucket.grades.includes(cls.gradeLabel)) {
        bucket.grades.push(cls.gradeLabel);
      }

      grouped.set(key, bucket);
    }

    let students = Array.from(grouped.values()).map((item) => ({
      id: item.id,
      studentName: item.studentName || "-",
      grade:
        item.grades.length === 1
          ? item.grades[0]
          : item.grades.join(", "),
      subject:
        item.subjects.length === 1
          ? item.subjects[0]
          : item.subjects.join(", "),
      district: item.district || "-",
      classNames: item.classNames,
      classNamesDisplay: item.classNames.join(", "),
    }));

    students.sort((a, b) =>
      String(a.studentName || "").localeCompare(String(b.studentName || ""))
    );

    const total = students.length;
    const totalPages = Math.max(1, Math.ceil(total / limitNumber));
    const startIndex = (pageNumber - 1) * limitNumber;
    const paginatedStudents = students.slice(
      startIndex,
      startIndex + limitNumber
    );

    return res.status(200).json({
      students: paginatedStudents,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages,
      filters: {
        classNames: allClassOptions,
        grades: allGradeOptions,
        subjects: allSubjectOptions,
      },
    });
  } catch (err) {
    console.error("getTeacherEnrollSubjectStudents error:", err);
    next(err);
  }
};