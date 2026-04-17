const {runLessonCleanupJob} = require("./lessonCleanupJob");
const {checkNegotiationTimeout} = require("./negotiationTimeoutServiceCorn");
const {startLessonReminderCron} = require("./lessonReminderCron");
const {runLessonCompletionJob} = require("./lessonCompletionJob");
const verifyPendingPayments = require("./payment/verifyPayments");
const autoReleaseLessons = require("./payment/autoRelease");
const retryPayouts = require("./payment/retryPayouts");
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
  // cron.schedule("*/5 * * * *", async () => {
  //  startLessonReminderCron();
  // });

  // every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    await verifyPendingPayments();
  });

  // every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    await autoReleaseLessons();
  });

  // every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    await retryPayouts();
  });

};