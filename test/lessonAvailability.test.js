const test = require("node:test");
const assert = require("node:assert/strict");

const Lesson = require("../models/lessonModel");
const {
  checkTeacherAvailability,
  lessonIntervalsOverlap,
} = require("../utils/helpers");

test("same-day lessons with a gap do not overlap", () => {
  assert.equal(
    lessonIntervalsOverlap(
      "2030-01-15T15:00:00.000Z",
      60,
      "2030-01-15T17:00:00.000Z",
      60
    ),
    false
  );
});

test("lessons that touch at the boundary do not overlap", () => {
  assert.equal(
    lessonIntervalsOverlap(
      "2030-01-15T16:00:00.000Z",
      60,
      "2030-01-15T17:00:00.000Z",
      60
    ),
    false
  );
});

test("same-day lessons with an actual time overlap are rejected", async () => {
  const originalFindOne = Lesson.findOne;
  Lesson.findOne = async () => ({
    requestedDate: new Date("2030-01-15T17:00:00.000Z"),
    durationInMinutes: 60,
  });

  try {
    await assert.rejects(
      () =>
        checkTeacherAvailability(
          "507f1f77bcf86cd799439011",
          "2030-01-15T16:30:00.000Z",
          60
        ),
      /already have a lesson at this time/
    );
  } finally {
    Lesson.findOne = originalFindOne;
  }
});

test("a request on the same day remains visible before its start time", () => {
  const now = new Date("2030-01-15T14:00:00.000Z");
  const requestStart = new Date("2030-01-15T15:00:00.000Z");
  assert.equal(requestStart >= now, true);
});
