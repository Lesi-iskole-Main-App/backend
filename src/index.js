import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import connectDB from "./infastructure/db.js";
import GlobalErrorHandler from "./api/middlewares/error-handling.js";

import authRouter from "./api/auth.js";
import userRouter from "./api/user.js";
import gradeRouter from "./api/grade.js";
import teacherAssignmentRouter from "./api/teacherAssignment.js";
import classRouter from "./api/class.js";
import lessonRouter from "./api/lesson.js";
import liveRouter from "./api/live.js";
import enrollRouter from "./api/enrollment.js";
import paymentRouter from "./api/payment.js";
import paperRouter from "./api/paper.js";
import questionRouter from "./api/question.js";
import rankRouter from "./api/rank.js";
import attemptRouter from "./api/attempt.js";
import uploadRouter from "./api/upload.js";
import languageRouter from "./api/language.js";
import progressRouter from "./api/progressbar.js";
import enrollTecherssubjectRouter from "./api/EnrollTecherssubject.js";
import techerspaperreportRouter from "./api/Techerspaperreport.js";
import teachersAssignedClassReportRouter from "./api/TeachersAssignedClassReport.js";
import teachersAssignedResultReportRouter from "./api/TeachersAssignedResultReport.js";
import studentRouter from "./api/student.js";
import recordingRouter from "./api/recording.js";
import adminResultReportRouter from "./api/AdminResultReport.js";
import reviewRouter from "./api/review.js";

const app = express();

const normalizeOrigin = (value) =>
  String(value || "")
    .trim()
    .replace(/\/$/, "");

const splitOrigins = (value) =>
  String(value || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

const frontendOrigins = [
  ...splitOrigins(process.env.FRONTEND_URL),
  ...splitOrigins(process.env.LOCAL_WEB_URL),
  "http://localhost:5173",
  "http://localhost:8081",
];

const adminOrigins = [
  ...splitOrigins(process.env.ADMIN_URL),
  ...splitOrigins(process.env.LOCAL_ADMIN_URL),
  "http://localhost:5174",
];

const teacherOrigins = [
  ...splitOrigins(process.env.TEACHER_URL),
  ...splitOrigins(process.env.LOCAL_TEACHER_URL),
  "http://localhost:5175",
];

const allowedOrigins = [
  ...new Set([...frontendOrigins, ...adminOrigins, ...teacherOrigins]),
];

const originCookieNames = new Map([
  ...frontendOrigins.map((origin) => [normalizeOrigin(origin), "student_token"]),
  ...adminOrigins.map((origin) => [normalizeOrigin(origin), "admin_token"]),
  ...teacherOrigins.map((origin) => [normalizeOrigin(origin), "teacher_token"]),
]);

const getRequestOrigin = (req) => {
  const origin = normalizeOrigin(req.get("origin"));
  if (origin) return origin;

  const referer = req.get("referer");
  if (!referer) return "";

  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return "";
  }
};

const getScopedCookieName = (req) => {
  const requestOrigin = getRequestOrigin(req);
  const originCookieName = originCookieNames.get(requestOrigin);

  if (originCookieName) return originCookieName;

  const clientType = String(req.body?.clientType || "").toLowerCase();
  if (clientType === "student_app") return "student_token";

  return "token";
};

if (!process.env.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is missing. Add JWT_SECRET in Vercel Environment Variables and redeploy."
  );
}

app.set("trust proxy", 1);

const corsMiddleware = cors({
  origin: (origin, cb) => {
    // Allows tools, server-to-server calls and requests without a browser Origin.
    if (!origin) return cb(null, true);

    const cleanOrigin = normalizeOrigin(origin);

    if (allowedOrigins.includes(cleanOrigin)) {
      return cb(null, true);
    }

    console.log("❌ CORS blocked origin:", origin);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.use(corsMiddleware);
app.options(/.*/, corsMiddleware);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/*
 * BACKEND-ONLY MULTI-WEBSITE AUTH FIX
 *
 * The existing auth controller calls res.cookie("token", ...).
 * This middleware keeps that controller unchanged, but it also creates a
 * different cookie for each frontend and adds the Partitioned attribute.
 *
 * Therefore the student, admin and teacher websites can stay logged in with
 * different accounts in the same browser without overwriting each other.
 */
app.use((req, res, next) => {
  const originalCookie = res.cookie.bind(res);

  res.cookie = (name, value, options = {}) => {
    if (name !== "token") {
      return originalCookie(name, value, options);
    }

    const isHosted =
      process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

    const authCookieOptions = {
      ...options,
      httpOnly: true,
      secure: isHosted,
      sameSite: isHosted ? "none" : "lax",
      path: "/",
      ...(isHosted ? { partitioned: true } : {}),
    };

    const scopedCookieName = getScopedCookieName(req);

    // Older-browser fallback: independent names prevent login collisions.
    if (scopedCookieName !== "token") {
      originalCookie(scopedCookieName, value, authCookieOptions);
    }

    // Modern-browser path: CHIPS keeps this cookie separate per top-level site.
    return originalCookie("token", value, authCookieOptions);
  };

  next();
});

app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/grade", gradeRouter);
app.use("/api/class", classRouter);
app.use("/api/teacher", teacherAssignmentRouter);
app.use("/api/live", liveRouter);
app.use("/api/lesson", lessonRouter);
app.use("/api/enroll", enrollRouter);
app.use("/api/recording", recordingRouter);
app.use("/api/rank", rankRouter);
app.use("/api/paper", paperRouter);
app.use("/api/question", questionRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/attempt", attemptRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/language", languageRouter);
app.use("/api/progress", progressRouter);
app.use("/api/teacher-enroll-subject", enrollTecherssubjectRouter);
app.use("/api/teachers-paper-report", techerspaperreportRouter);
app.use(
  "/api/teachers-assigned-class-report",
  teachersAssignedClassReportRouter
);
app.use(
  "/api/teachers-assigned-result-report",
  teachersAssignedResultReportRouter
);
app.use("/api/student", studentRouter);
app.use("/api/admin-result-report", adminResultReportRouter);
app.use("/api/review", reviewRouter);

app.get("/", (req, res) => res.send("OK"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use(GlobalErrorHandler);

connectDB();

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log("✅ Allowed origins:", allowedOrigins);
});

