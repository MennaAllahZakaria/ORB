const Lesson = require("../models/lessonModel");
const ApiError = require("./apiError");

exports.checkTeacherAvailability = async (teacherId, requestedDate, duration) => {

  const start = new Date(requestedDate);
  const end = new Date(start.getTime() + duration * 60000);

  const conflictLesson = await Lesson.findOne({
    acceptedTeacher: teacherId,
    status: "approved",
    requestedDate: {
      $lt: end
    }
  });

  if (!conflictLesson) return;

  const existingStart = new Date(conflictLesson.requestedDate);
  const existingEnd = new Date(
    existingStart.getTime() + conflictLesson.durationInMinutes * 60000
  );

  const overlap =
    start < existingEnd &&
    end > existingStart;

  if (overlap) {
    throw new ApiError(
      "You already have a lesson at this time",
      400
    );
  }

};