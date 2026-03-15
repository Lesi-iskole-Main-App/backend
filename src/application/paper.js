import mongoose from "mongoose";
import Paper, {
  PAPER_TYPES,
  PAYMENT_TYPES,
  ATTEMPTS_ALLOWED,
} from "../infastructure/schemas/paper.js";
import Grade from "../infastructure/schemas/grade.js";
import Question from "../infastructure/schemas/question.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const toStr = (v) => String(v || "").trim();

const normalizePaperType = (v) => {
  const raw = toStr(v);
  if (!raw) return "";
  const lower = raw.toLowerCase();

  const map = new Map([
    ["daily quiz", "Daily Quiz"],
    ["dailyquizz", "Daily Quiz"],

    ["topic wise paper", "Topic wise paper"],
    ["topic wise papers", "Topic wise paper"],
    ["topic-wise paper", "Topic wise paper"],
    ["topic-wise papers", "Topic wise paper"],

    ["model paper", "Model paper"],
    ["model papers", "Model paper"],

    ["past paper", "Past paper"],
    ["past papers", "Past paper"],
  ]);

  return map.get(lower) || raw;
};

const normalizePayment = (v) => {
  const lower = toStr(v).toLowerCase();
  if (lower === "practice") return "practise";
  return lower;
};

const normalizeStreamText = (v) => {
  return toStr(v).toLowerCase().replace(/[_\s-]+/g, " ").trim();
};

const formatStreamLabel = (value) => {
  const normalized = normalizeStreamText(value);
  if (!normalized) return "";

  const map = new Map([
    ["physical science", "Physical Science"],
    ["biological science", "Biological Science"],
    ["commerce", "Commerce"],
    ["arts", "Arts"],
    ["technology", "Technology"],
    ["common", "Common"],
  ]);

  return map.get(normalized) || normalized.replace(/\b\w/g, (m) => m.toUpperCase());
};

const getGradeMode = (gradeDoc) => {
  const flowType = toStr(gradeDoc?.flowType).toLowerCase();
  const gradeNo = Number(gradeDoc?.grade);

  if (flowType === "al") return "al";
  if (flowType === "normal") return "normal";

  if (gradeNo >= 1 && gradeNo <= 11) return "normal";
  if (gradeNo === 12 || gradeNo === 13) return "al";

  return "unknown";
};

const getGradeNumberSafe = (gradeDoc) => {
  const gradeNo = Number(gradeDoc?.grade);
  return Number.isFinite(gradeNo) ? gradeNo : null;
};

const findNormalSubjectById = (grade, subjectId) => {
  return (grade?.subjects || []).find((s) => String(s._id) === String(subjectId)) || null;
};

const findNormalSubjectByName = (grade, subjectName) => {
  const wanted = toStr(subjectName).toLowerCase();
  if (!wanted) return null;

  return (
    (grade?.subjects || []).find(
      (s) => toStr(s.subject).toLowerCase() === wanted
    ) || null
  );
};

const findALStreamById = (grade, streamId) => {
  return (grade?.streams || []).find((s) => String(s._id) === String(streamId)) || null;
};

const findALStreamByName = (grade, streamName) => {
  const wanted = normalizeStreamText(streamName);
  if (!wanted) return null;

  return (
    (grade?.streams || []).find(
      (s) => normalizeStreamText(s.stream) === wanted
    ) || null
  );
};

const findALSubjectById = (stream, subjectId) => {
  return (stream?.subjects || []).find((s) => String(s._id) === String(subjectId)) || null;
};

const findALSubjectByName = (stream, subjectName) => {
  const wanted = toStr(subjectName).toLowerCase();
  if (!wanted) return null;

  return (
    (stream?.subjects || []).find(
      (s) => toStr(s.subject).toLowerCase() === wanted
    ) || null
  );
};

const findGradeByNumber = async (gradeNumber) => {
  const gNo = Number(gradeNumber);
  if (!gNo || gNo < 1 || gNo > 13) return null;

  return Grade.findOne({
    grade: gNo,
    isActive: true,
  }).lean();
};

const readablePaperMeta = (paper, grade) => {
  const mode = getGradeMode(grade);
  const gradeNo = getGradeNumberSafe(grade);

  let subject = null;
  let stream = null;

  if (mode === "normal") {
    const sub =
      findNormalSubjectById(grade, paper.subjectId) ||
      findNormalSubjectById(grade, paper.streamSubjectId);

    subject = sub?.subject || "Unknown Subject";
  } else if (mode === "al") {
    const st =
      findALStreamById(grade, paper.streamId) ||
      findALStreamByName(grade, paper.stream);

    stream = formatStreamLabel(st?.stream || paper.stream || "");

    const sub =
      findALSubjectById(st, paper.streamSubjectId) ||
      findALSubjectById(st, paper.subjectId);

    subject = sub?.subject || "Unknown Subject";
  }

  return {
    grade: gradeNo,
    stream,
    subject,
  };
};

const getProgressForPaper = async (paper) => {
  const requiredCount = Number(paper?.questionCount || 0);
  const currentCount = await Question.countDocuments({ paperId: paper._id });

  return {
    paperId: String(paper._id),
    requiredCount,
    currentCount,
    remaining: Math.max(requiredCount - currentCount, 0),
    isComplete: currentCount >= requiredCount,
    oneQuestionAnswersCount: Number(paper?.oneQuestionAnswersCount || 4),
  };
};

const computeStatus = (paper, progress) => {
  if (paper?.isPublished) return "publish";
  if (progress?.isComplete) return "complete";
  return "in_progress";
};

const resolvePaperSelection = (grade, payload = {}, existing = null) => {
  const mode = getGradeMode(grade);

  if (mode === "normal") {
    const nextSubjectId =
      payload.subjectId !== undefined ? payload.subjectId : existing?.subjectId;
    const nextSubjectName =
      payload.subject !== undefined
        ? payload.subject
        : payload.subjectName !== undefined
        ? payload.subjectName
        : null;

    let subjectDoc = null;

    if (isValidId(nextSubjectId)) {
      subjectDoc = findNormalSubjectById(grade, nextSubjectId);
    }

    if (!subjectDoc && nextSubjectName) {
      subjectDoc = findNormalSubjectByName(grade, nextSubjectName);
    }

    if (!subjectDoc) {
      return {
        ok: false,
        message: "subjectId is required for grades 1-11",
      };
    }

    return {
      ok: true,
      data: {
        subjectId: String(subjectDoc._id),
        streamId: null,
        streamSubjectId: null,
      },
    };
  }

  if (mode === "al") {
    const nextStreamId =
      payload.streamId !== undefined ? payload.streamId : existing?.streamId;

    const nextStreamName =
      payload.stream !== undefined
        ? payload.stream
        : payload.streamName !== undefined
        ? payload.streamName
        : existing?.stream || null;

    const nextStreamSubjectId =
      payload.streamSubjectId !== undefined
        ? payload.streamSubjectId
        : payload.subjectId !== undefined
        ? payload.subjectId
        : existing?.streamSubjectId || existing?.subjectId;

    const nextSubjectName =
      payload.subject !== undefined
        ? payload.subject
        : payload.subjectName !== undefined
        ? payload.subjectName
        : null;

    let streamDoc = null;

    if (isValidId(nextStreamId)) {
      streamDoc = findALStreamById(grade, nextStreamId);
    }

    if (!streamDoc && nextStreamName) {
      streamDoc = findALStreamByName(grade, nextStreamName);
    }

    if (!streamDoc) {
      return {
        ok: false,
        message: "streamId is required for grade 12-13",
      };
    }

    let subjectDoc = null;

    if (isValidId(nextStreamSubjectId)) {
      subjectDoc = findALSubjectById(streamDoc, nextStreamSubjectId);
    }

    if (!subjectDoc && nextSubjectName) {
      subjectDoc = findALSubjectByName(streamDoc, nextSubjectName);
    }

    if (!subjectDoc) {
      return {
        ok: false,
        message: "streamSubjectId is required for grade 12-13",
      };
    }

    return {
      ok: true,
      data: {
        subjectId: null,
        streamId: String(streamDoc._id),
        streamSubjectId: String(subjectDoc._id),
      },
    };
  }

  return {
    ok: false,
    message:
      "Invalid grade number. This grade record has invalid grade/flowType data in database.",
  };
};

const getPublishedNormalSubjects = async ({ gradeDoc, paperType }) => {
  const papers = await Paper.find({
    gradeId: String(gradeDoc._id),
    paperType,
    isActive: true,
    isPublished: true,
    subjectId: { $ne: null },
  })
    .select("subjectId")
    .lean();

  const subjectIdSet = new Set(
    papers.map((p) => String(p.subjectId)).filter(Boolean)
  );

  return (gradeDoc.subjects || [])
    .filter((s) => subjectIdSet.has(String(s._id)))
    .map((s) => ({
      _id: String(s._id),
      subject: s.subject,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
};

const getPublishedALSubjectsAcrossAllGrades = async ({ streamName, paperType }) => {
  const alGrades = await Grade.find({
    flowType: "al",
    isActive: true,
  }).lean();

  if (!alGrades.length) {
    return { stream: formatStreamLabel(streamName), subjects: [] };
  }

  const matchedStreamEntries = [];

  for (const gradeDoc of alGrades) {
    const streamDoc = findALStreamByName(gradeDoc, streamName);
    if (!streamDoc) continue;

    matchedStreamEntries.push({
      gradeId: String(gradeDoc._id),
      streamId: String(streamDoc._id),
      streamDoc,
    });
  }

  if (!matchedStreamEntries.length) {
    return { stream: formatStreamLabel(streamName), subjects: [] };
  }

  const papers = await Paper.find({
    $or: matchedStreamEntries.map((x) => ({
      gradeId: x.gradeId,
      streamId: x.streamId,
      paperType,
      isActive: true,
      isPublished: true,
      streamSubjectId: { $ne: null },
    })),
  })
    .select("gradeId streamId streamSubjectId")
    .lean();

  const availableKeys = new Set(
    papers.map((p) => `${String(p.gradeId)}:${String(p.streamId)}:${String(p.streamSubjectId)}`)
  );

  const subjectMap = new Map();

  for (const entry of matchedStreamEntries) {
    for (const sub of entry.streamDoc.subjects || []) {
      const key = `${entry.gradeId}:${entry.streamId}:${String(sub._id)}`;
      if (!availableKeys.has(key)) continue;

      const normalizedName = toStr(sub.subject).toLowerCase();
      if (!normalizedName) continue;

      if (!subjectMap.has(normalizedName)) {
        subjectMap.set(normalizedName, {
          _id: String(sub._id),
          subject: sub.subject,
        });
      }
    }
  }

  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.subject.localeCompare(b.subject)
  );

  return {
    stream: formatStreamLabel(streamName),
    subjects,
  };
};

/* =========================================================
   ADMIN: FORM DATA
========================================================= */
export const getPaperFormData = async (req, res) => {
  try {
    const grades = await Grade.find({ isActive: true })
      .sort({ grade: 1, createdAt: 1 })
      .lean();

    return res.status(200).json({
      enums: {
        paperTypes: PAPER_TYPES,
        paymentTypes: PAYMENT_TYPES,
        attemptsAllowed: ATTEMPTS_ALLOWED,
        maxTimeMinutes: 180,
        maxQuestionCount: 50,
        minAnswerCount: 1,
        maxAnswerCount: 6,
      },
      grades,
    });
  } catch (err) {
    console.error("getPaperFormData error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   PUBLIC: SUBJECTS FOR STUDENT APP
   only subjects that already have published papers
========================================================= */
export const getPublicPaperSubjects = async (req, res) => {
  try {
    const rawGradeNumber = req.query?.gradeNumber;
    const rawStream = req.query?.stream;
    const paperType = normalizePaperType(req.query?.paperType || "Daily Quiz");

    if (!PAPER_TYPES.includes(paperType)) {
      return res
        .status(400)
        .json({ message: `paperType must be one of: ${PAPER_TYPES.join(", ")}` });
    }

    if (rawGradeNumber === undefined || rawGradeNumber === null || rawGradeNumber === "") {
      return res.status(400).json({ message: "gradeNumber is required" });
    }

    const gradeNumber = Number(rawGradeNumber);
    if (!gradeNumber || gradeNumber < 1 || gradeNumber > 13) {
      return res.status(400).json({ message: "Valid gradeNumber is required" });
    }

    // grades 1..11
    if (gradeNumber >= 1 && gradeNumber <= 11) {
      const gradeDoc = await findGradeByNumber(gradeNumber);

      if (!gradeDoc) {
        return res.status(404).json({ message: "Grade not found" });
      }

      const subjects = await getPublishedNormalSubjects({
        gradeDoc,
        paperType,
      });

      return res.status(200).json({ subjects });
    }

    // A/L => stream only, not grade specific
    const streamName = toStr(rawStream);
    if (!streamName) {
      return res.status(400).json({ message: "stream is required for A/L" });
    }

    const result = await getPublishedALSubjectsAcrossAllGrades({
      streamName,
      paperType,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("getPublicPaperSubjects error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: CREATE PAPER
========================================================= */
export const createPaper = async (req, res) => {
  try {
    const {
      gradeId,
      paperType,
      paperTitle,
      timeMinutes,
      questionCount,
      oneQuestionAnswersCount = 4,
      createdPersonName,
      payment = "free",
      amount = 0,
      attempts = 1,
      isActive = true,
    } = req.body;

    if (!isValidId(gradeId)) {
      return res.status(400).json({ message: "Valid gradeId is required" });
    }

    const grade = await Grade.findById(gradeId).lean();
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    const pType = normalizePaperType(paperType);
    if (!PAPER_TYPES.includes(pType)) {
      return res
        .status(400)
        .json({ message: `paperType must be one of: ${PAPER_TYPES.join(", ")}` });
    }

    const title = toStr(paperTitle);
    if (!title) return res.status(400).json({ message: "paperTitle is required" });

    const t = Number(timeMinutes);
    if (!t || t < 1 || t > 180) {
      return res.status(400).json({ message: "timeMinutes must be 1..180" });
    }

    const qc = Number(questionCount);
    if (!qc || qc < 1 || qc > 50) {
      return res.status(400).json({ message: "questionCount must be 1..50" });
    }

    const oq = Number(oneQuestionAnswersCount);
    if (!oq || oq < 1 || oq > 6) {
      return res.status(400).json({ message: "oneQuestionAnswersCount must be 1..6" });
    }

    const creator = toStr(createdPersonName);
    if (!creator) {
      return res.status(400).json({ message: "createdPersonName is required" });
    }

    const pay = normalizePayment(payment);
    if (!PAYMENT_TYPES.includes(pay)) {
      return res
        .status(400)
        .json({ message: `payment must be one of: ${PAYMENT_TYPES.join(", ")}` });
    }

    const att = Number(attempts);
    if (!ATTEMPTS_ALLOWED.includes(att)) {
      return res.status(400).json({ message: "attempts must be 1, 2, or 3" });
    }

    const resolved = resolvePaperSelection(grade, req.body);
    if (!resolved.ok) {
      return res.status(400).json({ message: resolved.message });
    }

    let finalAmount = 0;
    if (pay === "paid") {
      const a = Number(amount);
      if (!a || a <= 0) {
        return res.status(400).json({ message: "amount must be > 0 for paid papers" });
      }
      finalAmount = a;
    }

    const doc = await Paper.create({
      gradeId,
      subjectId: resolved.data.subjectId,
      streamId: resolved.data.streamId,
      streamSubjectId: resolved.data.streamSubjectId,

      paperType: pType,
      paperTitle: title,

      timeMinutes: t,
      questionCount: qc,
      oneQuestionAnswersCount: oq,

      createdPersonName: creator,

      payment: pay,
      amount: finalAmount,
      attempts: att,

      isPublished: false,
      publishedAt: null,

      isActive: Boolean(isActive),
      createdBy: req.user?.id || null,
    });

    const meta = readablePaperMeta(doc.toObject(), grade);
    const progress = await getProgressForPaper(doc.toObject());
    const status = computeStatus(doc.toObject(), progress);

    return res.status(201).json({
      message: "Paper created",
      paper: { ...doc.toObject(), meta, progress, status },
    });
  } catch (err) {
    console.error("createPaper error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: GET ALL PAPERS
========================================================= */
export const getAllPapers = async (req, res) => {
  try {
    const list = await Paper.find().sort({ createdAt: -1 }).lean();

    const gradeIds = [...new Set(list.map((p) => String(p.gradeId)).filter(Boolean))];
    const grades = await Grade.find({ _id: { $in: gradeIds } }).lean();
    const gradeMap = new Map(grades.map((g) => [String(g._id), g]));

    const papers = await Promise.all(
      list.map(async (p) => {
        const g = gradeMap.get(String(p.gradeId)) || null;
        const meta = g ? readablePaperMeta(p, g) : null;
        const progress = await getProgressForPaper(p);
        const status = computeStatus(p, progress);
        return { ...p, meta, progress, status };
      })
    );

    return res.status(200).json({ papers });
  } catch (err) {
    console.error("getAllPapers error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: UPDATE PAPER
========================================================= */
export const updatePaperById = async (req, res) => {
  try {
    const { paperId } = req.params;
    if (!isValidId(paperId)) return res.status(400).json({ message: "Invalid paperId" });

    const existing = await Paper.findById(paperId).lean();
    if (!existing) return res.status(404).json({ message: "Paper not found" });

    if (existing.isPublished) {
      return res.status(400).json({ message: "Published paper cannot be edited" });
    }

    const nextGradeId = req.body.gradeId !== undefined ? req.body.gradeId : existing.gradeId;
    if (!isValidId(nextGradeId)) {
      return res.status(400).json({ message: "Valid gradeId is required" });
    }

    const grade = await Grade.findById(nextGradeId).lean();
    if (!grade) return res.status(404).json({ message: "Grade not found" });

    const patch = { gradeId: nextGradeId };

    const resolved = resolvePaperSelection(grade, req.body, existing);
    if (!resolved.ok) {
      return res.status(400).json({ message: resolved.message });
    }

    patch.subjectId = resolved.data.subjectId;
    patch.streamId = resolved.data.streamId;
    patch.streamSubjectId = resolved.data.streamSubjectId;

    if (req.body.paperTitle !== undefined) {
      const v = toStr(req.body.paperTitle);
      if (!v) return res.status(400).json({ message: "paperTitle is required" });
      patch.paperTitle = v;
    }

    if (req.body.createdPersonName !== undefined) {
      const v = toStr(req.body.createdPersonName);
      if (!v) return res.status(400).json({ message: "createdPersonName is required" });
      patch.createdPersonName = v;
    }

    if (req.body.paperType !== undefined) {
      const pType = normalizePaperType(req.body.paperType);
      if (!PAPER_TYPES.includes(pType)) {
        return res
          .status(400)
          .json({ message: `paperType must be one of: ${PAPER_TYPES.join(", ")}` });
      }
      patch.paperType = pType;
    }

    if (req.body.timeMinutes !== undefined) {
      const t = Number(req.body.timeMinutes);
      if (!t || t < 1 || t > 180) {
        return res.status(400).json({ message: "timeMinutes must be 1..180" });
      }
      patch.timeMinutes = t;
    }

    if (req.body.questionCount !== undefined) {
      const qc = Number(req.body.questionCount);
      if (!qc || qc < 1 || qc > 50) {
        return res.status(400).json({ message: "questionCount must be 1..50" });
      }
      patch.questionCount = qc;
    }

    if (req.body.oneQuestionAnswersCount !== undefined) {
      const oq = Number(req.body.oneQuestionAnswersCount);
      if (!oq || oq < 1 || oq > 6) {
        return res.status(400).json({ message: "oneQuestionAnswersCount must be 1..6" });
      }
      patch.oneQuestionAnswersCount = oq;
    }

    if (req.body.attempts !== undefined) {
      const att = Number(req.body.attempts);
      if (!ATTEMPTS_ALLOWED.includes(att)) {
        return res.status(400).json({ message: "attempts must be 1, 2, or 3" });
      }
      patch.attempts = att;
    }

    if (req.body.payment !== undefined) {
      const pay = normalizePayment(req.body.payment);
      if (!PAYMENT_TYPES.includes(pay)) {
        return res
          .status(400)
          .json({ message: `payment must be one of: ${PAYMENT_TYPES.join(", ")}` });
      }

      patch.payment = pay;

      if (pay === "paid") {
        const a = Number(req.body.amount);
        if (!a || a <= 0) {
          return res.status(400).json({ message: "amount must be > 0 for paid papers" });
        }
        patch.amount = a;
      } else {
        patch.amount = 0;
      }
    } else if (req.body.amount !== undefined) {
      return res.status(400).json({ message: "Provide payment together with amount" });
    }

    if (req.body.isActive !== undefined) {
      patch.isActive = Boolean(req.body.isActive);
    }

    const updated = await Paper.findByIdAndUpdate(paperId, patch, { new: true }).lean();

    const g = await Grade.findById(updated.gradeId).lean();
    const meta = g ? readablePaperMeta(updated, g) : null;
    const progress = await getProgressForPaper(updated);
    const status = computeStatus(updated, progress);

    return res.status(200).json({
      message: "Paper updated",
      paper: { ...updated, meta, progress, status },
    });
  } catch (err) {
    console.error("updatePaperById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: DELETE PAPER
========================================================= */
export const deletePaperById = async (req, res) => {
  try {
    const { paperId } = req.params;
    if (!isValidId(paperId)) return res.status(400).json({ message: "Invalid paperId" });

    const deleted = await Paper.findByIdAndDelete(paperId);
    if (!deleted) return res.status(404).json({ message: "Paper not found" });

    return res.status(200).json({ message: "Paper deleted" });
  } catch (err) {
    console.error("deletePaperById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   ADMIN: PUBLISH PAPER
========================================================= */
export const publishPaperById = async (req, res) => {
  try {
    const { paperId } = req.params;
    if (!isValidId(paperId)) return res.status(400).json({ message: "Invalid paperId" });

    const paper = await Paper.findById(paperId).lean();
    if (!paper) return res.status(404).json({ message: "Paper not found" });

    if (paper.isPublished) {
      return res.status(400).json({ message: "Paper already published" });
    }

    const progress = await getProgressForPaper(paper);
    if (!progress.isComplete) {
      return res.status(400).json({ message: "Only complete papers can be published" });
    }

    const updated = await Paper.findByIdAndUpdate(
      paperId,
      { isPublished: true, publishedAt: new Date() },
      { new: true }
    ).lean();

    const g = await Grade.findById(updated.gradeId).lean();
    const meta = g ? readablePaperMeta(updated, g) : null;
    const nextProgress = await getProgressForPaper(updated);
    const status = computeStatus(updated, nextProgress);

    return res.status(200).json({
      message: "Paper published",
      paper: { ...updated, meta, progress: nextProgress, status },
    });
  } catch (err) {
    console.error("publishPaperById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* =========================================================
   PUBLIC: GET PUBLISHED PAPERS FOR STUDENT APP
========================================================= */
export const getPublishedPapersPublic = async (req, res) => {
  try {
    const rawGradeNumber = req.query?.gradeNumber;
    const level = toStr(req.query?.level).toLowerCase();
    const paperType = normalizePaperType(req.query?.paperType || "Model paper");
    const subjectName = toStr(req.query?.subject);
    const streamName = toStr(req.query?.stream);

    const hasGradeNumber =
      rawGradeNumber !== undefined &&
      rawGradeNumber !== null &&
      rawGradeNumber !== "";

    const gradeNumber = hasGradeNumber ? Number(rawGradeNumber) : null;

    if (!PAPER_TYPES.includes(paperType)) {
      return res
        .status(400)
        .json({ message: `paperType must be one of: ${PAPER_TYPES.join(", ")}` });
    }

    // normal grades 1..11
    if (hasGradeNumber && gradeNumber >= 1 && gradeNumber <= 11) {
      const gradeDoc = await findGradeByNumber(gradeNumber);
      if (!gradeDoc) return res.status(404).json({ message: "Grade not found" });

      if (!subjectName) {
        return res.status(400).json({ message: "subject is required" });
      }

      const sub = findNormalSubjectByName(gradeDoc, subjectName);
      if (!sub) return res.status(404).json({ message: "Subject not found for this grade" });

      const papers = await Paper.find({
        gradeId: String(gradeDoc._id),
        subjectId: String(sub._id),
        paperType,
        isActive: true,
        isPublished: true,
      })
        .sort({ publishedAt: 1, createdAt: 1, _id: 1 })
        .lean();

      const formatted = papers.map((p) => ({
        _id: String(p._id),
        paperTitle: p.paperTitle,
        questionCount: Number(p.questionCount || 0),
        timeMinutes: Number(p.timeMinutes || 0),
        attempts: Number(p.attempts || 1),
        payment: p.payment,
        amount: Number(p.amount || 0),
        createdAt: p.createdAt || null,
        publishedAt: p.publishedAt || null,
      }));

      return res.status(200).json({ papers: formatted });
    }

    // A/L => by stream + subject, across all A/L grades
    const isALRequest =
      level === "al" ||
      gradeNumber === 12 ||
      gradeNumber === 13 ||
      (!hasGradeNumber && !!streamName);

    if (!isALRequest) {
      return res.status(400).json({ message: "Invalid gradeNumber or level" });
    }

    if (!streamName) {
      return res.status(400).json({ message: "stream is required for A/L" });
    }

    if (!subjectName) {
      return res.status(400).json({ message: "subject is required for A/L" });
    }

    const alGrades = await Grade.find({
      flowType: "al",
      isActive: true,
    }).lean();

    if (!alGrades.length) {
      return res.status(404).json({ message: "A/L grade data not found" });
    }

    const orQuery = [];

    for (const gradeDoc of alGrades) {
      const st = findALStreamByName(gradeDoc, streamName);
      if (!st) continue;

      const sub = findALSubjectByName(st, subjectName);
      if (!sub) continue;

      orQuery.push({
        gradeId: String(gradeDoc._id),
        streamId: String(st._id),
        streamSubjectId: String(sub._id),
        paperType,
        isActive: true,
        isPublished: true,
      });
    }

    if (!orQuery.length) {
      return res.status(200).json({ papers: [] });
    }

    const papers = await Paper.find({ $or: orQuery })
      .sort({ publishedAt: 1, createdAt: 1, _id: 1 })
      .lean();

    const formatted = papers.map((p) => ({
      _id: String(p._id),
      paperTitle: p.paperTitle,
      questionCount: Number(p.questionCount || 0),
      timeMinutes: Number(p.timeMinutes || 0),
      attempts: Number(p.attempts || 1),
      payment: p.payment,
      amount: Number(p.amount || 0),
      createdAt: p.createdAt || null,
      publishedAt: p.publishedAt || null,
    }));

    return res.status(200).json({ papers: formatted });
  } catch (err) {
    console.error("getPublishedPapersPublic error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};