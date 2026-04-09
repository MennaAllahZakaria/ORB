const {runLessonCleanupJob} = require("./lessonCleanupJob");
const {checkNegotiationTimeout} = require("./negotiationTimeoutServiceCorn");
const {startLessonReminderCron} = require("./lessonReminderCron");
const {runLessonCompletionJob} = require("./lessonCompletionJob");
const cron = require("node-cron");

exports.initializeCronJobs = () => {

  // runs every hour
  cron.schedule("0 * * * *", async () => {
    await runLessonCleanupJob();
  });

  // runs every minute
  runLessonCompletionJob();

  // runs every minute
  // cron.schedule("* * * * *", async () => {
  //   await checkNegotiationTimeout();
  // });

  //runs every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
   startLessonReminderCron();
  });

};