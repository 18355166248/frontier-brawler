import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "native/cocos-poc");
const templatePath = join(project, "build-android.json");
const creator = process.env.COCOS_CREATOR_PATH
  ?? "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator";
const sdkPath = process.env.ANDROID_SDK_ROOT
  ?? process.env.ANDROID_HOME
  ?? join(homedir(), "Library/Android/sdk");
const javaHome = process.env.JAVA_HOME
  ?? "/Applications/Android Studio.app/Contents/jbr/Contents/Home";

function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`${label} 不存在：${path}`);
}

async function findNdkPath() {
  if (process.env.ANDROID_NDK_HOME) return process.env.ANDROID_NDK_HOME;
  const ndkRoot = join(sdkPath, "ndk");
  const versions = (await readdir(ndkRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  if (!versions[0]) throw new Error(`Android NDK 未安装：${ndkRoot}`);
  return join(ndkRoot, versions[0]);
}

function run(command, args, cwd, env = process.env, accepted = [0]) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) {
    throw new Error(`${command} 失败，退出码 ${result.status ?? "unknown"}`);
  }
}

requirePath(creator, "Cocos Creator CLI");
requirePath(sdkPath, "Android SDK");
requirePath(javaHome, "JDK");

const ndkPath = await findNdkPath();
requirePath(ndkPath, "Android NDK");

const config = JSON.parse(await readFile(templatePath, "utf8"));
Object.assign(config.packages.android, {
  sdkPath,
  ndkPath,
  javaHome,
  javaPath: join(javaHome, "bin/java"),
});

// Cocos 的命令行构建只读取配置文件；临时注入本机工具链路径，避免把个人目录提交进仓库。
const generatedConfig = join(tmpdir(), "frontier-brawler-cocos-android.json");
const buildLog = join(tmpdir(), "frontier-brawler-cocos-android.log");
await writeFile(generatedConfig, `${JSON.stringify(config, null, 2)}\n`);

// 原生包必须先刷新共享核心，避免 APK 悄悄携带旧战斗逻辑。
run(process.execPath, [join(root, "tools/build_cocos_core.mjs")], root);
run(process.execPath, [join(root, "tools/sync_cocos_art.mjs")], root);

run(
  creator,
  ["--project", project, "--build", `configPath=${generatedConfig};logDest=${buildLog}`],
  root,
  process.env,
  // Cocos Creator 3.8.x 的命令行成功构建会返回 36。
  [0, 36],
);

const gradleProject = join(project, "build/android/proj");
run("./gradlew", ["assembleDebug"], gradleProject, { ...process.env, JAVA_HOME: javaHome });

console.log(`APK: ${join(gradleProject, "build/frontier-brawler/outputs/apk/debug/frontier-brawler-debug.apk")}`);
