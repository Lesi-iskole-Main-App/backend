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

// ✅ NEW
import adminResultReportRouter from "./api/AdminResultReport.js";

const app = express();

// ✅ allow multiple frontends (student + admin + teacher + local dev)
const allowedOrigins = [
  process.env.FRONTEND_URL, // student web
  process.env.ADMIN_URL, // admin panel
  process.env.TEACHER_URL, // teacher panel

  // optional local dev urls
  process.env.LOCAL_WEB_URL,
  process.env.LOCAL_ADMIN_URL,
  process.env.LOCAL_TEACHER_URL,

  // common local defaults (safe)
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:8081",
].filter(Boolean);

// ✅ important for cookies on cross-site requests
app.set("trust proxy", 1);

// ✅ build ONE cors middleware so we can reuse for preflight too
const corsMiddleware = cors({
  origin: (origin, cb) => {
    // allow server-to-server / curl / mobile apps without Origin header
    if (!origin) return cb(null, true);

    // normalize origin (remove trailing slash)
    const cleanOrigin = String(origin).replace(/\/$/, "");

    const ok = allowedOrigins
      .map((o) => String(o).replace(/\/$/, ""))
      .includes(cleanOrigin);

    if (ok) return cb(null, true);

    console.log("❌ CORS blocked origin:", origin);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.use(corsMiddleware);

// ✅ preflight (Express 5 compatible)
app.options(/.*/, corsMiddleware);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// routes
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/grade", gradeRouter);
app.use("/api/class", classRouter);
app.use("/api/teacher", teacherAssignmentRouter);
app.use("/api/live", liveRouter); // ✅ removed "sz"
app.use("/api/lesson", lessonRouter);
app.use("/api/enroll", enrollRouter);
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
app.use("/api/teachers-assigned-class-report", teachersAssignedClassReportRouter);
app.use(
  "/api/teachers-assigned-result-report",
  teachersAssignedResultReportRouter
);
app.use("/api/student", studentRouter);
app.get("/", (req, res) => res.send("OK"));
app.get("/api/health", (req, res) => res.json({ ok: true }));
// ✅ NEW
app.use("/api/admin-result-report", adminResultReportRouter);

// error handler
app.use(GlobalErrorHandler);

connectDB();

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log("✅ Allowed origins:", allowedOrigins);
});