const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ENCRYPTION_KEY ||= "0000000000000000000000000000000000000000000000000000000000000000";

const Lesson = require("../models/lessonModel");
const firebaseAdminPath = require.resolve("../fireBase/admin");
require.cache[firebaseAdminPath] = {
  id: firebaseAdminPath,
  filename: firebaseAdminPath,
  loaded: true,
  exports: {
    messaging: () => ({ send: async () => undefined }),
  },
};
const { handleZoomEvent } = require("../services/zoomService");

test("Zoom nested meeting webhooks finalize a short meeting as completed", async () => {
  const originalFindOne = Lesson.findOne;
  const lesson = {
    _id: "lesson-1",
    zoomMeetingId: "123456789",
    meetingProvider: "zoom",
    meetingStatus: "upcoming",
    meetingStartTime: null,
    meetingEndTime: null,
    sessionVerified: false,
    finalCompletionStatus: "pending",
    reviewStatus: "waiting_second_party",
    disputeFlag: false,
    endNotificationSent: false,
    activeParticipants: [],
    student: { _id: "student-1" },
    acceptedTeacher: { _id: "teacher-1" },
    save: async function save() {
      return this;
    },
  };

  Lesson.findOne = () => ({
    populate: async () => lesson,
  });

  try {
    await handleZoomEvent({
      event: "meeting.started",
      event_ts: Date.parse("2030-01-15T15:00:00.000Z"),
      payload: {
        object: {
          id: "123456789",
          start_time: "2030-01-15T15:00:00.000Z",
        },
      },
    });

    assert.equal(lesson.meetingStatus, "ongoing");
    assert.equal(lesson.meetingStartTime.toISOString(), "2030-01-15T15:00:00.000Z");

    await handleZoomEvent({
      event: "meeting.ended",
      event_ts: Date.parse("2030-01-15T15:36:00.000Z"),
      payload: {
        object: {
          id: "123456789",
          start_time: "2030-01-15T15:00:00.000Z",
          end_time: "2030-01-15T15:35:00.000Z",
        },
      },
    });

    assert.equal(lesson.meetingStatus, "finished");
    assert.equal(lesson.sessionVerified, true);
    assert.equal(lesson.finalCompletionStatus, "completed");
    assert.equal(lesson.reviewStatus, "waiting_second_party");
    assert.equal(lesson.meetingEndTime.toISOString(), "2030-01-15T15:35:00.000Z");
  } finally {
    Lesson.findOne = originalFindOne;
  }
});

test("a delayed meeting.started event does not reopen a finished meeting", async () => {
  const originalFindOne = Lesson.findOne;
  const lesson = {
    _id: "lesson-2",
    zoomMeetingId: "987654321",
    meetingStatus: "finished",
    meetingStartTime: new Date("2030-01-15T15:00:00.000Z"),
    meetingEndTime: new Date("2030-01-15T15:35:00.000Z"),
    sessionVerified: true,
    finalCompletionStatus: "completed",
    reviewStatus: "waiting_second_party",
    disputeFlag: false,
    activeParticipants: [],
    student: { _id: "student-1" },
    acceptedTeacher: { _id: "teacher-1" },
    save: async function save() {
      throw new Error("stale event should not save");
    },
  };

  Lesson.findOne = () => ({
    populate: async () => lesson,
  });

  try {
    await handleZoomEvent({
      event: "meeting.started",
      event_ts: Date.parse("2030-01-15T15:10:00.000Z"),
      payload: {
        object: {
          id: "987654321",
          start_time: "2030-01-15T15:10:00.000Z",
        },
      },
    });

    assert.equal(lesson.meetingStatus, "finished");
    assert.equal(lesson.finalCompletionStatus, "completed");
  } finally {
    Lesson.findOne = originalFindOne;
  }
});

test("late attendance events do not reopen a lesson already marked problematic", async () => {
  const originalFindOne = Lesson.findOne;
  const lesson = {
    _id: "lesson-3",
    zoomMeetingId: "555555555",
    meetingStatus: "finished",
    status: "problem",
    finalCompletionStatus: "incomplete",
    reviewStatus: "under_admin_review",
    disputeFlag: false,
    meetingStartTime: new Date("2030-01-15T15:00:00.000Z"),
    meetingEndTime: new Date("2030-01-15T15:20:00.000Z"),
    activeParticipants: [],
    student: { _id: "student-1" },
    acceptedTeacher: { _id: "teacher-1" },
    save: async function save() {
      throw new Error("problem state must not be reopened");
    },
  };

  Lesson.findOne = () => ({
    populate: async () => lesson,
  });

  try {
    await handleZoomEvent({
      event: "meeting.started",
      event_ts: Date.parse("2030-01-15T15:05:00.000Z"),
      payload: {
        object: {
          id: "555555555",
          start_time: "2030-01-15T15:05:00.000Z",
        },
      },
    });

    await handleZoomEvent({
      event: "meeting.participant_joined",
      event_ts: Date.parse("2030-01-15T15:06:00.000Z"),
      payload: {
        object: {
          id: "555555555",
          participant: { id: "participant-1" },
        },
      },
    });

    assert.equal(lesson.status, "problem");
    assert.equal(lesson.meetingStatus, "finished");
    assert.deepEqual(lesson.activeParticipants, []);
  } finally {
    Lesson.findOne = originalFindOne;
  }
});
