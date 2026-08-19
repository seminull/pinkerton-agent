import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { nativeSmsSyncAvailable, syncNow } from "./communicationSync";

const SMS_SYNC_TASK = "pinkerton-sms-catch-up";

// Task definitions must live at module scope so Android can load them without
// first mounting the React component tree.
TaskManager.defineTask(SMS_SYNC_TASK, async () => {
  if (!nativeSmsSyncAvailable) return BackgroundTask.BackgroundTaskResult.Failed;
  try {
    await syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export const registerSmsBackgroundSync = async (): Promise<void> => {
  if (!nativeSmsSyncAvailable) return;
  await BackgroundTask.registerTaskAsync(SMS_SYNC_TASK, {
    // Android WorkManager treats this as a minimum, not an exact schedule. The
    // broadcast receiver handles immediacy; this worker is the retry path.
    minimumInterval: 15,
  });
};
