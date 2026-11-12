import { resolve, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const appRoot = resolve(import.meta.dir, "..");
const prod = process.env.NODE_ENV === "production";
const appConfig = JSON.parse(readFileSync(join(appRoot, "app.config.json"), "utf8")) as { profile?: string };
const profilePath = appConfig.profile ? join(appRoot, "profiles", appConfig.profile, "routine.json") : "";
const profileRules = profilePath && existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, "utf8")) as { noRedistributePhaseIds?: string[] } : {};


export const config = {
  contentDir: resolve(process.env.CONTENT_DIR || join(appRoot, "data")),
  moduleEnv: process.env.MODULES,
  prod,
  profile: appConfig.profile || "",
  profileRules,
  appRoot,
  dataDir: resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || (prod ? "/data" : join(appRoot, ".data"))),
  devImgDir: join(resolve(process.env.CONTENT_DIR || join(appRoot, "data")), "img"),
  webDist: join(appRoot, "web", "dist"),
  port: Number(process.env.PORT || 3000),
  passwordHash: process.env.APP_PASSWORD_HASH || "",
  apiToken: process.env.API_TOKEN || "",
  sessionSecret: process.env.SESSION_SECRET || (prod ? "" : "dev-session-secret"),
  backupKeep: Number(process.env.BACKUP_KEEP || 14),
  backupPushUrl: process.env.BACKUP_PUSH_URL || "",
  version: "0.1.0",
};
