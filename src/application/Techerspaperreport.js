import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import Paper, { PAPER_TYPES } from "../infastructure/schemas/paper.js";
import User from "../infastructure/schemas/user.js";

const toId = (value) => String(value || "").trim();

const uniqueValues = (arr = []) => {
  return [...new Set(arr.map((v) => String(v || "").trim()).filter(Boolean))];
};

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

const normalizeText = (value = "") => String(value || "").trim().toLowerCase();

const getGradeLabel = (gradeDoc) => {
  if (!gradeDoc) return "";
  if (gradeDoc.flowType === "al") return "A/L";
  return `Grade ${gradeDoc.grade}`;
};

const sortGradeLabels = (items = []) => {
  return [...items].sort((a, b) => {
    const aa = String(a || "").trim();
    const bb = String(b || "").trim();

    if (aa === "A/L" && bb !== "A/L") return 1;
    if (bb === "A/L" && aa !== "A/L") return -1;

    const na = Number(aa.replace(/\D/g, "")) || 0;
    const nb = Number(bb.replace(/\D/g, "")) || 0;
    return na - nb;
  });
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
    if (!gradeDoc) continue;

    let subject = "";
    let stream = "";
    const gradeLabel = getGradeLabel(gradeDoc);

    if (gradeDoc.flowType === "normal") {
      const subjectDoc = (gradeDoc.subjects || []).find(
        (s) => toId(s._id) === toId(c.subjectId)
      );
      subject = String(subjectDoc?.subject || "").trim();
    } else {
      if (c.alSubjectName) {
        subject = String(c.alSubjectName || "").trim();
      } else if (c.streamId && c.streamSubjectId) {
        const legacyStreamDoc = (gradeDoc.streams || []).find(
          (s) => toId(s._id) === toId(c.streamId)
        );
        stream = getStreamLabel(legacyStreamDoc?.stream || "");
        const legacySubjectDoc = (legacyStreamDoc?.subjects || []).find(
          (s) => toId(s._id) === toId(c.streamSubjectId)
        );
        subject = String(legacySubjectDoc?.subject || "").trim();
      }

      if (!stream && Array.isArray(c.streamIds) && c.streamIds.length) {
        const selectedStreamIds = c.streamIds.map((x) => toId(x));
        const streamNames = (gradeDoc.streams || [])
          .filter((s) => selectedStreamIds.includes(toId(s._id)))
          .map((s) => getStreamLabel(s.stream))
          .filter(Boolean);

        stream = streamNames.join(", ");
      }
    }

    classMap.set(toId(c._id), {
      classId: toId(c._id),
      className: String(c.className || "").trim(),
      batchNumber: String(c.batchNumber || "").trim(),
      gradeId: toId(c.gradeId),
      flowType: String(gradeDoc.flowType || "normal"),
      grade: Number(gradeDoc.grade || 0) || null,
      gradeLabel,
      subject,
      stream,
      subjectDisplay:
        gradeDoc.flowType === "al"
          ? [stream, subject].filter(Boolean).join(" - ")
          : subject,
    });
  }

  return classMap;
};

const buildPaperRows = async (papers = [], classMetaList = []) => {
  const gradeIds = uniqueValues(papers.map((p) => p.gradeId));

  const gradeDocs = gradeIds.length
    ? await Grade.find({ _id: { $in: gradeIds } })
        .select("_id grade flowType subjects streams")
        .lean()
    : [];

  const gradeMap = new Map(gradeDocs.map((g) => [toId(g._id), g]));

  const allowedNormalKeys = new Set();
  const allowedALKeys = new Set();

  for (const cls of classMetaList) {
    if (cls.flowType === "normal") {
      const key = `${normalizeText(cls.gradeLabel)}__${normalizeText(
        cls.subjectDisplay
      )}`;
      allowedNormalKeys.add(key);
    } else {
      const key = `${normalizeText(cls.gradeLabel)}__${normalizeText(
        cls.subjectDisplay
      )}`;
      allowedALKeys.add(key);
    }
  }

  const rows = [];

  for (const paper of papers) {
    const gradeDoc = gradeMap.get(toId(paper.gradeId));
    if (!gradeDoc) continue;

    if (gradeDoc.flowType === "normal") {
      const subjectDoc = (gradeDoc.subjects || []).find(
        (s) => toId(s._id) === toId(paper.subjectId)
      );

      const subject = String(subjectDoc?.subject || "").trim();
      const gradeLabel = `Grade ${gradeDoc.grade}`;
      const normalKey = `${normalizeText(gradeLabel)}__${normalizeText(subject)}`;

      if (!allowedNormalKeys.has(normalKey)) continue;

      rows.push({
        paperId: toId(paper._id),
        paperType: String(paper.paperType || "").trim(),
        paperName: String(paper.paperTitle || "").trim(),
        grade: gradeLabel,
        subject,
        time: `${Number(paper.timeMinutes || 0)} min`,
        questionCount: Number(paper.questionCount || 0),
        createdBy: String(paper.createdPersonName || "").trim(),
      });

      continue;
    }

    let stream = "";
    let subject = "";

    const streamDoc = (gradeDoc.streams || []).find(
      (s) => toId(s._id) === toId(paper.streamId)
    );

    if (streamDoc) {
      stream = getStreamLabel(streamDoc.stream || "");
      const subjectDoc = (streamDoc.subjects || []).find(
        (s) => toId(s._id) === toId(paper.streamSubjectId)
      );
      subject = String(subjectDoc?.subject || "").trim();
    }

    const subjectDisplay = [stream, subject].filter(Boolean).join(" - ");
    const alKey = `${normalizeText("a/l")}__${normalizeText(subjectDisplay)}`;

    if (!allowedALKeys.has(alKey)) continue;

    rows.push({
      paperId: toId(paper._id),
      paperType: String(paper.paperType || "").trim(),
      paperName: String(paper.paperTitle || "").trim(),
      grade: "A/L",
      subject: subjectDisplay,
      time: `${Number(paper.timeMinutes || 0)} min`,
      questionCount: Number(paper.questionCount || 0),
      createdBy: String(paper.createdPersonName || "").trim(),
    });
  }

  return rows;
};

export const getTechersPaperReport = async (req, res, next) => {
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

    const {
      paperName = "",
      subject = "",
      grade = "",
      paperType = "Daily Quiz",
    } = req.query || {};

    const teacherClasses = await ClassModel.find({
      teacherIds: teacherId,
      isActive: true,
    })
      .select(
        "_id className batchNumber gradeId subjectId streamId streamSubjectId alSubjectName streamIds teacherIds isActive"
      )
      .lean();

    if (!teacherClasses.length) {
      return res.status(200).json({
        message: "No classes found for teacher",
        total: 0,
        filters: {
          grades: [],
          subjects: [],
          paperTypes: PAPER_TYPES,
        },
        reports: [],
      });
    }

    const classMetaMap = await buildClassMetaMap(teacherClasses);
    const classMetaList = Array.from(classMetaMap.values());

    const normalGradeIds = uniqueValues(
      classMetaList
        .filter((c) => c.flowType === "normal")
        .map((c) => c.gradeId)
    );

    const normalSubjectIds = uniqueValues(
      teacherClasses
        .filter((c) => c.subjectId)
        .map((c) => c.subjectId)
    );

    const alGradeIds = uniqueValues(
      classMetaList
        .filter((c) => c.flowType === "al")
        .map((c) => c.gradeId)
    );

    const paperQueries = [];

    if (normalGradeIds.length && normalSubjectIds.length) {
      paperQueries.push({
        gradeId: { $in: normalGradeIds },
        subjectId: { $in: normalSubjectIds },
        isActive: true,
      });
    }

    if (alGradeIds.length) {
      paperQueries.push({
        gradeId: { $in: alGradeIds },
        streamId: { $ne: null },
        streamSubjectId: { $ne: null },
        isActive: true,
      });
    }

    if (!paperQueries.length) {
      return res.status(200).json({
        message: "No papers found",
        total: 0,
        filters: {
          grades: sortGradeLabels(
            uniqueValues(classMetaList.map((x) => x.gradeLabel)).filter(Boolean)
          ),
          subjects: uniqueValues(
            classMetaList.map((x) => x.subjectDisplay).filter(Boolean)
          ).sort((a, b) => a.localeCompare(b)),
          paperTypes: PAPER_TYPES,
        },
        reports: [],
      });
    }

    let papers = await Paper.find({
      $or: paperQueries,
    }).lean();

    let rows = await buildPaperRows(papers, classMetaList);

    if (paperName) {
      const key = String(paperName).trim().toLowerCase();
      rows = rows.filter((r) =>
        String(r.paperName || "").toLowerCase().includes(key)
      );
    }

    if (subject) {
      rows = rows.filter(
        (r) => normalizeText(r.subject) === normalizeText(subject)
      );
    }

    if (grade) {
      rows = rows.filter((r) => normalizeText(r.grade) === normalizeText(grade));
    }

    if (paperType) {
      rows = rows.filter(
        (r) => normalizeText(r.paperType) === normalizeText(paperType)
      );
    }

    rows.sort((a, b) => {
      const byPaperName = String(a.paperName || "").localeCompare(
        String(b.paperName || "")
      );
      if (byPaperName !== 0) return byPaperName;
      return String(a.subject || "").localeCompare(String(b.subject || ""));
    });

    const gradeOptions = sortGradeLabels(
      uniqueValues(classMetaList.map((x) => x.gradeLabel)).filter(Boolean)
    );

    const subjectOptions = uniqueValues(
      classMetaList.map((x) => x.subjectDisplay).filter(Boolean)
    ).sort((a, b) => a.localeCompare(b));

    return res.status(200).json({
      message: "Teacher paper report fetched successfully",
      total: rows.length,
      filters: {
        grades: gradeOptions,
        subjects: subjectOptions,
        paperTypes: PAPER_TYPES,
      },
      reports: rows,
    });
  } catch (err) {
    console.error("getTechersPaperReport error:", err);
    next(err);
  }
};