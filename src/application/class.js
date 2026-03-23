import mongoose from "mongoose";
import ClassModel from "../infastructure/schemas/class.js";
import Grade from "../infastructure/schemas/grade.js";
import User from "../infastructure/schemas/user.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const norm = (v) => String(v || "").trim();

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const normalizeSubjectKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const AL_STREAM_LABELS = {
  physical_science: "Physical Science",
  biological_science: "Biological Science",
  commerce: "Commerce",
  arts: "Arts",
  technology: "Technology",
  common: "Common",
};

const getStreamLabel = (value) => {
  const key = normalizeKey(value);
  return AL_STREAM_LABELS[key] || value || "";
};

const matchALStream = (streamValue, input) => {
  const a = normalizeKey(streamValue);
  const b = normalizeKey(input);
  if (!a || !b) return false;
  if (a === b) return true;
  const label = normalizeKey(AL_STREAM_LABELS[a] || "");
  return label === b;
};

const validateTeachers = async (teacherIds) => {
  if (!Array.isArray(teacherIds)) {
    return { ok: false, code: 400, message: "teacherIds must be an array" };
  }

  if (teacherIds.length === 0) {
    return { ok: true };
  }

  for (const tid of teacherIds) {
    if (!isValidId(tid)) {
      return { ok: false, code: 400, message: `Invalid teacherId: ${tid}` };
    }

    const t = await User.findById(tid).lean();
    if (!t || t.role !== "teacher") {
      return { ok: false, code: 404, message: `Teacher not found: ${tid}` };
    }

    if (!t.isApproved) {
      return {
        ok: false,
        code: 403,
        message: `Teacher must be approved: ${tid}`,
      };
    }
  }

  return { ok: true };
};

const getALSubjectRelation = (grade, alSubjectName) => {
  const cleanName = String(alSubjectName || "").trim();
  const subjectKey = normalizeSubjectKey(cleanName);

  if (!subjectKey) {
    return {
      ok: false,
      code: 400,
      message: "alSubjectName is required for A/L",
    };
  }

  const matchedStreams = (grade?.streams || []).filter((st) =>
    (st?.subjects || []).some(
      (sub) => normalizeSubjectKey(sub?.subject) === subjectKey
    )
  );

  if (matchedStreams.length === 0) {
    return {
      ok: false,
      code: 400,
      message: "A/L subject not found in any stream",
    };
  }

  const foundSubject =
    matchedStreams
      .flatMap((st) => st?.subjects || [])
      .find((sub) => normalizeSubjectKey(sub?.subject) === subjectKey) || null;

  return {
    ok: true,
    subjectName: cleanName || foundSubject?.subject || "",
    subjectKey,
    streamIds: matchedStreams.map((st) => st._id),
    streamNames: matchedStreams.map((st) => getStreamLabel(st?.stream)),
  };
};

const validateGradeRelation = async ({ gradeId, subjectId, alSubjectName }) => {
  const grade = await Grade.findById(gradeId).lean();
  if (!grade) return { ok: false, code: 404, message: "Grade not found" };

  if (grade.flowType === "normal") {
    if (!subjectId) {
      return {
        ok: false,
        code: 400,
        message: "subjectId is required for grades 1-11",
      };
    }

    if (!isValidId(subjectId)) {
      return {
        ok: false,
        code: 400,
        message: "Invalid subjectId",
      };
    }

    const validSubjectIds = new Set(
      (grade.subjects || []).map((s) => String(s._id))
    );

    if (!validSubjectIds.has(String(subjectId))) {
      return {
        ok: false,
        code: 400,
        message: "subjectId does not belong to this grade",
      };
    }

    const subjectObj = (grade.subjects || []).find(
      (s) => String(s._id) === String(subjectId)
    );

    return {
      ok: true,
      grade,
      mode: "normal",
      gradeNo: grade.grade,
      gradeLabel: `Grade ${grade.grade}`,
      subjectName: subjectObj?.subject || "",
      streamName: "",
      streamNames: [],
      streamIds: [],
      alSubjectName: "",
      alSubjectKey: "",
    };
  }

  if (grade.flowType === "al") {
    const alRel = getALSubjectRelation(grade, alSubjectName);
    if (!alRel.ok) return alRel;

    return {
      ok: true,
      grade,
      mode: "al",
      gradeNo: 12,
      gradeLabel: "A/L",
      subjectName: alRel.subjectName,
      streamName: alRel.streamNames.join(", "),
      streamNames: alRel.streamNames,
      streamIds: alRel.streamIds,
      alSubjectName: alRel.subjectName,
      alSubjectKey: alRel.subjectKey,
    };
  }

  return {
    ok: false,
    code: 400,
    message: "Unsupported grade flow",
  };
};

const buildClassResponse = (doc) => {
  const grade = doc?.gradeId;

  if (!grade) {
    return {
      ...doc,
      batchNumber: doc?.batchNumber || "",
      gradeNo: null,
      gradeLabel: "",
      streamName: "",
      streamNames: [],
      subjectName: "",
    };
  }

  if (grade.flowType === "normal") {
    const subjectObj = (grade.subjects || []).find(
      (s) => String(s._id) === String(doc.subjectId)
    );

    return {
      ...doc,
      batchNumber: doc?.batchNumber || "",
      gradeNo: grade.grade,
      gradeLabel: `Grade ${grade.grade}`,
      streamName: "",
      streamNames: [],
      subjectName: subjectObj?.subject || "Unknown",
    };
  }

  if (grade.flowType === "al") {
    const streamIds = Array.isArray(doc?.streamIds)
      ? doc.streamIds.map((x) => String(x))
      : [];

    const streamNames = (grade.streams || [])
      .filter((s) => streamIds.includes(String(s._id)))
      .map((s) => getStreamLabel(s?.stream));

    return {
      ...doc,
      batchNumber: doc?.batchNumber || "",
      gradeNo: 12,
      gradeLabel: "A/L",
      streamName: streamNames.join(", "),
      streamNames,
      subjectName: doc?.alSubjectName || "Unknown",
    };
  }

  return {
    ...doc,
    batchNumber: doc?.batchNumber || "",
    gradeNo: null,
    gradeLabel: "",
    streamName: "",
    streamNames: [],
    subjectName: "",
  };
};

// CREATE CLASS
export const createClass = async (req, res) => {
  try {
    const {
      className,
      batchNumber,
      gradeId,
      subjectId = null,
      alSubjectName = "",
      teacherIds = [],
      imageUrl = "",
      imagePublicId = "",
    } = req.body;

    if (!className || !batchNumber || !gradeId) {
      return res
        .status(400)
        .json({ message: "className, batchNumber and gradeId are required" });
    }

    if (!isValidId(gradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const rel = await validateGradeRelation({
      gradeId,
      subjectId,
      alSubjectName,
    });
    if (!rel.ok) return res.status(rel.code).json({ message: rel.message });

    const tchk = await validateTeachers(teacherIds);
    if (!tchk.ok) return res.status(tchk.code).json({ message: tchk.message });

    const payload = {
      className: norm(className),
      batchNumber: norm(batchNumber),
      gradeId,
      teacherIds,
      imageUrl: String(imageUrl || "").trim(),
      imagePublicId: String(imagePublicId || "").trim(),
      createdBy: req.user?.id || null,

      subjectId: null,
      streamId: null,
      streamSubjectId: null,
      alSubjectName: "",
      alSubjectKey: "",
      streamIds: [],
    };

    if (rel.mode === "normal") {
      payload.subjectId = subjectId;
    } else {
      payload.alSubjectName = rel.alSubjectName;
      payload.alSubjectKey = rel.alSubjectKey;
      payload.streamIds = rel.streamIds || [];
    }

    const doc = await ClassModel.create(payload);

    return res.status(201).json({ message: "Class created", class: doc });
  } catch (err) {
    console.error("createClass error:", err);
    if (err.code === 11000) {
      return res.status(409).json({
        message:
          "Duplicate class (same className + batchNumber + grade + subject)",
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET ALL CLASSES
export const getAllClass = async (req, res) => {
  try {
    const list = await ClassModel.find()
      .populate("gradeId", "grade flowType title subjects streams")
      .populate("teacherIds", "name email phonenumber isApproved role")
      .sort({ createdAt: -1 })
      .lean();

    const classes = list.map(buildClassResponse);

    return res.status(200).json({ classes });
  } catch (err) {
    console.error("getAllClass error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// GET CLASS BY ID
export const getClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const doc = await ClassModel.findById(classId)
      .populate("gradeId", "grade flowType title subjects streams")
      .populate("teacherIds", "name email phonenumber isApproved role")
      .lean();

    if (!doc) return res.status(404).json({ message: "Class not found" });

    return res.status(200).json({
      class: buildClassResponse(doc),
    });
  } catch (err) {
    console.error("getClassById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// UPDATE CLASS
export const updateClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const doc = await ClassModel.findById(classId);
    if (!doc) return res.status(404).json({ message: "Class not found" });

    const {
      className,
      batchNumber,
      gradeId,
      subjectId,
      alSubjectName,
      teacherIds,
      isActive,
      imageUrl,
      imagePublicId,
    } = req.body;

    const newGradeId = gradeId !== undefined ? gradeId : doc.gradeId;
    const newSubjectId = subjectId !== undefined ? subjectId : doc.subjectId;
    const newALSubjectName =
      alSubjectName !== undefined ? alSubjectName : doc.alSubjectName;

    if (!isValidId(newGradeId)) {
      return res.status(400).json({ message: "Invalid gradeId" });
    }

    const rel = await validateGradeRelation({
      gradeId: newGradeId,
      subjectId: newSubjectId,
      alSubjectName: newALSubjectName,
    });
    if (!rel.ok) return res.status(rel.code).json({ message: rel.message });

    if (teacherIds !== undefined) {
      const tchk = await validateTeachers(teacherIds);
      if (!tchk.ok) return res.status(tchk.code).json({ message: tchk.message });
      doc.teacherIds = teacherIds;
    }

    if (className !== undefined) doc.className = norm(className);
    if (batchNumber !== undefined) doc.batchNumber = norm(batchNumber);
    if (gradeId !== undefined) doc.gradeId = newGradeId;
    if (isActive !== undefined) doc.isActive = Boolean(isActive);

    if (rel.mode === "normal") {
      doc.subjectId = newSubjectId;
      doc.streamId = null;
      doc.streamSubjectId = null;
      doc.alSubjectName = "";
      doc.alSubjectKey = "";
      doc.streamIds = [];
    } else {
      doc.subjectId = null;
      doc.streamId = null;
      doc.streamSubjectId = null;
      doc.alSubjectName = rel.alSubjectName;
      doc.alSubjectKey = rel.alSubjectKey;
      doc.streamIds = rel.streamIds || [];
    }

    if (imageUrl !== undefined) doc.imageUrl = String(imageUrl || "").trim();
    if (imagePublicId !== undefined) {
      doc.imagePublicId = String(imagePublicId || "").trim();
    }

    await doc.save();

    return res.status(200).json({ message: "Class updated", class: doc });
  } catch (err) {
    console.error("updateClassById error:", err);
    if (err.code === 11000) {
      return res.status(409).json({
        message:
          "Duplicate class (same className + batchNumber + grade + subject)",
      });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE CLASS
export const deleteClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    if (!isValidId(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const deleted = await ClassModel.findByIdAndDelete(classId);
    if (!deleted) return res.status(404).json({ message: "Class not found" });

    return res.status(200).json({ message: "Class deleted" });
  } catch (err) {
    console.error("deleteClassById error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PUBLIC
export const getClassesPublic = async (req, res) => {
  try {
    const gradeNumber = String(req.query.gradeNumber || "").trim();
    const subjectName = String(req.query.subjectName || "").trim();
    const streamName = String(req.query.streamName || "").trim();

    let gradeDoc = null;
    let query = { isActive: true };

    if (
      gradeNumber === "12" ||
      gradeNumber === "13" ||
      gradeNumber.toLowerCase() === "al"
    ) {
      gradeDoc = await Grade.findOne({
        flowType: "al",
        isActive: true,
      }).lean();

      if (!gradeDoc) {
        return res.status(404).json({ message: "A/L not found" });
      }

      query.gradeId = gradeDoc._id;

      let matchedStream = null;
      let selectedSubjectName = "";

      if (streamName) {
        matchedStream = (gradeDoc.streams || []).find((s) =>
          matchALStream(s?.stream, streamName)
        );

        if (!matchedStream) {
          return res.status(404).json({ message: "Stream not found in A/L" });
        }
      }

      if (subjectName) {
        const subjectKey = normalizeSubjectKey(subjectName);

        if (matchedStream) {
          const existsInThatStream = (matchedStream.subjects || []).some(
            (s) => normalizeSubjectKey(s?.subject) === subjectKey
          );

          if (!existsInThatStream) {
            return res.status(404).json({ message: "Subject not found in stream" });
          }
        }

        query.alSubjectKey = subjectKey;

        const foundAny = (gradeDoc.streams || [])
          .flatMap((s) => s.subjects || [])
          .find((s) => normalizeSubjectKey(s?.subject) === subjectKey);

        if (!foundAny) {
          return res.status(404).json({ message: "Subject not found in A/L" });
        }

        selectedSubjectName = foundAny.subject;
      } else if (matchedStream) {
        const subjectKeys = [...new Set(
          (matchedStream.subjects || [])
            .map((s) => normalizeSubjectKey(s?.subject))
            .filter(Boolean)
        )];

        query.alSubjectKey = { $in: subjectKeys };
      }

      const list = await ClassModel.find(query)
        .populate("teacherIds", "name email phonenumber isApproved role")
        .sort({ createdAt: -1 })
        .lean();

      const classes = list.map((c) => {
        const streamIds = Array.isArray(c?.streamIds)
          ? c.streamIds.map((x) => String(x))
          : [];

        const streamNames = (gradeDoc.streams || [])
          .filter((s) => streamIds.includes(String(s._id)))
          .map((s) => getStreamLabel(s?.stream));

        return {
          _id: c._id,
          className: c.className,
          batchNumber: c.batchNumber || "",
          gradeLabel: "A/L",
          streamName: streamNames.join(", "),
          streamNames,
          subjectName: c.alSubjectName || selectedSubjectName || "",
          imageUrl: c.imageUrl || "",
          teacherCount: Array.isArray(c.teacherIds) ? c.teacherIds.length : 0,
          teachers: (c.teacherIds || []).map((t) => ({
            _id: t._id,
            name: t.name,
          })),
          createdAt: c.createdAt,
        };
      });

      return res.status(200).json({ classes });
    }

    const gradeNo = Number(gradeNumber);
    if (!gradeNo || gradeNo < 1 || gradeNo > 11) {
      return res.status(400).json({ message: "gradeNumber must be 1-11 or 12/13/al" });
    }

    gradeDoc = await Grade.findOne({
      flowType: "normal",
      grade: gradeNo,
      isActive: true,
    }).lean();

    if (!gradeDoc) {
      return res.status(404).json({ message: "Grade not found" });
    }

    query.gradeId = gradeDoc._id;

    let selectedSubjectName = "";

    if (subjectName) {
      const subjectObj = (gradeDoc.subjects || []).find(
        (s) =>
          String(s?.subject || "").trim().toLowerCase() ===
          subjectName.toLowerCase()
      );

      if (!subjectObj) {
        return res.status(404).json({ message: "Subject not found in this grade" });
      }

      query.subjectId = subjectObj._id;
      selectedSubjectName = subjectObj.subject;
    }

    const list = await ClassModel.find(query)
      .populate("teacherIds", "name email phonenumber isApproved role")
      .sort({ createdAt: -1 })
      .lean();

    const classes = list.map((c) => {
      const sub = (gradeDoc.subjects || []).find(
        (s) => String(s._id) === String(c.subjectId)
      );

      return {
        _id: c._id,
        className: c.className,
        batchNumber: c.batchNumber || "",
        gradeLabel: `Grade ${gradeNo}`,
        streamName: "",
        streamNames: [],
        subjectName: sub?.subject || selectedSubjectName || "",
        imageUrl: c.imageUrl || "",
        teacherCount: Array.isArray(c.teacherIds) ? c.teacherIds.length : 0,
        teachers: (c.teacherIds || []).map((t) => ({
          _id: t._id,
          name: t.name,
        })),
        createdAt: c.createdAt,
      };
    });

    return res.status(200).json({ classes });
  } catch (err) {
    console.error("getClassesPublic error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};