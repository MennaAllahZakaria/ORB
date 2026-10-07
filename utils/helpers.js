const Lesson = require("../models/lessonModel");
const ApiError = require("./apiError");

const lessonIntervalsOverlap = (
  requestedStart,
  requestedDuration,
  existingStart,
  existingDuration
) => {
  const start = new Date(requestedStart).getTime();
  const end = start + Number(requestedDuration) * 60 * 1000;
  const occupiedStart = new Date(existingStart).getTime();
  const occupiedEnd =
    occupiedStart + Number(existingDuration) * 60 * 1000;

  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(occupiedStart) &&
    Number.isFinite(occupiedEnd) &&
    start < occupiedEnd &&
    end > occupiedStart
  );
};

exports.checkTeacherAvailability = async (teacherId, requestedDate, duration) => {
  const start = new Date(requestedDate);
  const durationMinutes = Number(duration);

  if (
    Number.isNaN(start.getTime()) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    throw new ApiError("Invalid lesson time or duration", 400);
  }

  const end = new Date(
    start.getTime() + durationMinutes * 60 * 1000
  );

  const conflictLesson = await Lesson.findOne({
    acceptedTeacher: teacherId,
    status: "approved",
    $expr: {
      $and: [
        { $lt: ["$requestedDate", end] },
        {
          $gt: [
            {
              $add: [
                "$requestedDate",
                {
                  $multiply: [
                    "$durationInMinutes",
                    60 * 1000,
                  ],
                },
              ],
            },
            start,
          ],
        },
      ],
    },
  });

  if (!conflictLesson) return;

  if (
    lessonIntervalsOverlap(
      start,
      durationMinutes,
      conflictLesson.requestedDate,
      conflictLesson.durationInMinutes
    )
  ) {
    throw new ApiError(
      "You already have a lesson at this time",
      400
    );
  }

};

exports.lessonIntervalsOverlap = lessonIntervalsOverlap;
