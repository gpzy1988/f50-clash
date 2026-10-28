//<script>
// 防御性兜底：UFI 平台/其他插件可能引用全局 TAG，避免 "TAG is not defined" 报错
try { if (typeof window !== 'undefined' && typeof window.TAG === 'undefined') window.TAG = 'f50mgr'; } catch (e) {}
// f50mgr + OpenClash 功能合并版：
//  新增：📥更新订阅（走 f50mgr subscription update，与 MGR 网页控制台同源 ureq 通道）/ 📚订阅管理（多订阅选择·切换生效·同步 secrets.toml）/ 📋订阅状态 / 🗑清空订阅
//        🗂规则集（多规则选择·新建/编辑/删除/切换，注入 config.yaml rules 段）/ 🛠自定义规则（编辑当前生效）/ 📄配置文件
//        ⚙️运行设置（运行模式 增强/TUN/混合 + 代理模式 规则/全局/直连，改写 config.yaml 并重载）
//        🧭代理选择（读 external-controller/secret 走 mihomo API，分组/节点一键切换）
//        ⏰定时任务（订阅自动更新·间隔小时可配·内核自动更新·定时重启，设备端 f50mgr-sched.sh 守护）
//        🔄更新内核升级为 多源（GitHub 官方 + gh-proxy/ghfast/ghproxy 镜像自动回退）
//  📡订阅设置 已移除：单条订阅地址的查看/修改请用 MGR 控制台，或在「📥 更新订阅」无地址时直接填 URL
//  保留：启动/停止/重启/状态/密钥/主控制面板/日志/开机自启/导入组件/备份/卸载/测延迟 全部原有功能
//
// ==================== 更新日志（Changelog） ====================
// v1.19 系列（本次迭代，对应 aka 1IEpti9URE）：
//   1. 版本更新（内核）功能重构：
//      - 删除内核分支选择（Master/Alpha-Smart 下拉），改为版本号直接选择
//      - 版本列表 = GitHub 前 30 个 tag（轻量 tags 端点，KB 级响应不拉爆 CPU）
//      - Prerelease-Alpha 固定置顶硬编码入下拉（打开弹窗即有、刷新失败也有）
//        · 选 Prerelease-Alpha → 自动查该 release 资产名提取 alpha 构建（alpha-5b79f3c）→ 下载 Alpha-Smart 内核
//        · 选 v1.19.33 等普通 tag → 直接下载 mihomo-linux-arm64-<tag>.gz 稳定版
//        · latest（最新）→ 拉最新 release 的 tag 后同上
//      - 弹窗顶部显示当前内核版本 + 是否 Alpha-Smart 标识（读 mihomo -v）
//   2. 下载提速（修复"下载安装巨慢"）：
//      - 代理探测前移到 TAG 获取之前（TAG 与下载共用代理通道）
//      - TAG 获取 6 源并行 + 直连/代理双通道，快源（99988866）秒取
//      - 下载前按真实下载链路（BASE/TAG/资产名 range 测速）排序，快源优先
//      - 下载超时压缩：直连 10s / 代理 20s；完成后清理临时文件
//   3. 稳定性修复（"signal is aborted" / CPU 拉爆）：
//      - 版本列表改轻量 tags 端点（此前 releases?per_page=30 大 JSON 被环境中止）
//      - 各脚本执行时长压缩（PXY 探测 12s→4s、测速 6s→4s、单源直连/代理并行化）
//      - 刷新版本防抖锁、打开弹窗不自动拉取
//   4. 其他：彻底删除 4 个功能（不走代理IP / 直连白名单 / 大陆白名单 / GEO 数据库订阅）；
//      定时任务保存修复；延迟面板恢复原始链接方式（代理优先+直连兜底）；
//      下载/测速均走"后端直连+代理"双通道，防延迟过高下载失败
// v1.19 之前：合并 OpenClash 核心功能（见上方功能说明）；修复内核下载 URL 缺版本段；
//             Alpha-Smart 版本号从 release 资产名提取；本地更新防 CPU 拉爆
// ==============================================================
(() => {
  // ============ 常量 ============
  const F50MGR_DIR = '/data/adb/f50mgr';
  const F50MGR_BIN = F50MGR_DIR + '/bin/f50mgr';
  const F50MGR_WATCH = F50MGR_DIR + '/bin/f50mgr-watch.sh';
  const F50MGR_LOG = F50MGR_DIR + '/run/f50mgr.log';
  const F50MGR_TOML = F50MGR_DIR + '/config/f50mgr.toml';
  const F50MGR_SECRETS = F50MGR_DIR + '/config/secrets.toml';
  const AUTH_FILE = F50MGR_DIR + '/run/.auth_secret';
  const BOOT_FILE = '/sdcard/ufi_tools_boot.sh';
  const BOOT_LINE = 'sh /data/adb/f50mgr/bin/f50mgr-watch.sh &';
  const APP_FILES = '/data/data/com.minikano.f50_sms/files';
  const UI_PORT = 14180;
  // OpenClash 移植：配置覆写 / 定时任务相关路径
  const CFG_YAML = F50MGR_DIR + '/config/clash/config.yaml';
  const CUSTOM_RULES = F50MGR_DIR + '/config/custom_rules.txt';
  const SCHEDULE_FILE = F50MGR_DIR + '/config/schedule.json';
  const SCHED_SCRIPT = F50MGR_DIR + '/bin/f50mgr-sched.sh';
  const SCHED_LINE = 'sh /data/adb/f50mgr/bin/f50mgr-sched.sh &';
  const OVERLAY_SCRIPT = F50MGR_DIR + '/bin/f50mgr-apply-overlay.sh';
  // OpenClash 移植：多订阅 / 多规则集相关路径
  const SUB_LIB = F50MGR_DIR + '/config/subscriptions.json';
  const RULESETS = F50MGR_DIR + '/config/rulesets.json';
  const RULES_DIR = F50MGR_DIR + '/config/rules';
  const RULES_ACTIVE = F50MGR_DIR + '/config/rules/active.txt';
  const RULE_DEFAULTS = { list: [], active: '' };
  // 探测 f50mgr Web(14180) 实际监听的地址：F50 有多个 IP（127.0.0.1 / 蜂窝 / br0），
  // UFI_DATA.lan_ipaddr 可能是蜂窝 IP 而非内网 192.168.0.1，直接按 netstat 实际绑定为准
  const detectMgrIp = async () => {
    const res = await runShellWithRoot(
      `ip=$(netstat -tlnp 2>/dev/null | awk '/:14180 / && /LISTEN/{print $4; exit}' | sed 's/:[0-9]*$//'); [ -n "$ip" ] && echo "$ip" || echo '192.168.0.1'`,
    );
    const ip = ((res.content || '').trim().split('\n').pop() || '').trim();
    return ip || '192.168.0.1';
  };
  const webUI = (ip) => `http://${ip || '192.168.0.1'}:${UI_PORT}/`;

  // ============ 基础工具 ============
  const checkAdvanceFunc = async () => {
    const res = await runShellWithRoot('whoami');
    return !!(res.content && res.content.includes('root'));
  };

  const createRandomString = (length = 8) => {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  };

  const askConfirm = (id, title, body, ok = '确认', cancel = '取消') =>
    new Promise((resolve) => {
      const { el, close } = createFixedToast(
        id,
        `<div style="pointer-events:all;width:90vw;max-width:520px;">
        <div class="title" style="margin:0">${title}</div>
        <div style="margin-top:10px;font-size:.7rem;line-height:1.75">${body}</div>
        <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button class="ok">${ok}</button>
          <button class="cancel">${cancel}</button>
        </div>
      </div>`,
      );
      const done = (value) => {
        close();
        resolve(value);
      };
      el.querySelector('.ok')?.addEventListener('click', () => done(true));
      el.querySelector('.cancel')?.addEventListener('click', () => done(false));
    });

  // 弹出一个可复制的文本对话框
  const showTextDialog = (id, title, text) => {
    const safe = (text || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    const { el, close } = createFixedToast(
      id,
      `<div style="pointer-events:all;width:90vw;max-width:560px;">
        <div class="title" style="margin:0">${title}</div>
        <div style="margin-top:10px;font-size:.7rem;line-height:1.6;max-height:50vh;overflow-y:auto;word-break:break-all;background:rgba(0,0,0,.25);padding:10px;border-radius:8px;">${safe}</div>
        <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button class="ok">关闭</button>
        </div>
      </div>`,
    );
    el.querySelector('.ok')?.addEventListener('click', () => close());
  };

  // 输入框对话框（返回 Promise<string|null>）
  const askInput = (id, title, body, placeholder = '', def = '') =>
    new Promise((resolve) => {
      const rid = 'f50mgr_input_' + createRandomString(6);
      const { el, close } = createFixedToast(
        id,
        `<div style="pointer-events:all;width:90vw;max-width:520px;">
        <div class="title" style="margin:0">${title}</div>
        <div style="margin-top:10px;font-size:.7rem;line-height:1.75">${body}</div>
        <input id="${rid}" type="text" placeholder="${placeholder}" value="${def}" style="margin-top:12px;width:calc(100% - 16px);padding:8px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;box-sizing:border-box;">
        <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button class="ok">确定</button>
          <button class="cancel">取消</button>
        </div>
      </div>`,
      );
      const done = (value) => {
        close();
        resolve(value);
      };
      el.querySelector('.ok')?.addEventListener('click', () => {
        done(el.querySelector('#' + rid)?.value?.trim() || null);
      });
      el.querySelector('.cancel')?.addEventListener('click', () => done(null));
    });

  // 多行文本编辑对话框（返回 Promise<string|null>，null = 取消）
  const askTextarea = (id, title, body, def = '') =>
    new Promise((resolve) => {
      const rid = 'f50mgr_area_' + createRandomString(6);
      const safeDef = String(def || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const { el, close } = createFixedToast(
        id,
        `<div style="pointer-events:all;width:90vw;max-width:560px;">
        <div class="title" style="margin:0">${title}</div>
        <div style="margin-top:10px;font-size:.7rem;line-height:1.75">${body}</div>
        <textarea id="${rid}" spellcheck="false" style="margin-top:12px;width:calc(100% - 16px);height:190px;padding:8px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;box-sizing:border-box;font-family:monospace;font-size:.65rem;white-space:pre;overflow:auto;">${safeDef}</textarea>
        <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button class="ok">保存</button>
          <button class="cancel">取消</button>
        </div>
      </div>`,
      );
      const done = (value) => {
        close();
        resolve(value);
      };
      el.querySelector('.ok')?.addEventListener('click', () => {
        done(el.querySelector('#' + rid)?.value || '');
      });
      el.querySelector('.cancel')?.addEventListener('click', () => done(null));
    });

  // ============ 状态查询 ============
  const checkIsInstalled = async () => {
    const res = await runShellWithRoot(
      `ls ${F50MGR_BIN} ${F50MGR_TOML} 2>/dev/null`,
    );
    return res.success && res.content && res.content.includes('f50mgr');
  };

  const isDaemonRunning = async () => {
    const res = await runShellWithRoot(`pgrep -f 'f50mgr daemon'`);
    return !!(res.content && res.content.trim() !== '');
  };

  // 真实健康状态：S=已停止 / R=运行中（daemon+mihomo+config+端口齐全）/ W=运行中但异常（缺件）
  const getRunState = async () => {
    const res = await runShellWithRoot(`
D=$(pgrep -f 'f50mgr daemon' | head -1)
M=$(pgrep -x mihomo | head -1)
P=$(netstat -tlnp 2>/dev/null | grep ':14180 .*LISTEN' | head -1)
C=$(ls ${F50MGR_DIR}/config/clash/config.yaml >/dev/null 2>&1 && echo yes)
if [ -z "$D" ]; then echo S; elif [ -n "$P" ] && [ -n "$M" ] && [ "$C" = yes ]; then echo R; else echo W; fi
`);
    const s = (res.content || '').trim().slice(-1);
    return s === 'R' || s === 'W' || s === 'S' ? s : 'S';
  };

  // 猫猫同款自启：走 UFI-TOOLS 平台 boot.sh 钩子（root 来自原厂工程通道，不依赖 Magisk）
  const checkIsBootUp = async () => {
    const res = await runShellWithRoot(
      `grep -qF '${BOOT_LINE}' ${BOOT_FILE} 2>/dev/null; echo $?`,
    );
    return res.content.trim() === '0';
  };

  // ============ 操作 ============
  // 上传组件 zip 到面板
  const saveZip = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await (
        await fetch(`${KANO_baseURL}/upload_img`, {
          method: 'POST',
          headers: common_headers,
          body: formData,
        })
      ).json();
      return res.url || null;
    } catch (e) {
      return null;
    }
  };

  const importZip = async (zipUrl) => {
    // 安装/还原流程拆多段独立执行：避免单次超长脚本被运行环境超时截断；任一段失败都能精确定位
    const exec = async (script) => {
      const res = await runShellWithRoot(script);
      return (res && res.content) || '';
    };
    const showFail = (tag, out) => {
      createToast('导入失败：' + tag, 'red');
      showTextDialog('f50mgr_log', '导入失败详情', (out || '').slice(0, 3000));
    };
    // 段 0：解包（按魔数自动识别 zip / tar.gz）+ 判断包类型（备份包 / 组件包）
    const s0 = `
mkdir -p ${F50MGR_DIR}/bin ${F50MGR_DIR}/config/clash ${F50MGR_DIR}/config/easytier ${F50MGR_DIR}/data ${F50MGR_DIR}/run
rm -rf ${F50MGR_DIR}/.install ${F50MGR_DIR}/.install.zip ${F50MGR_DIR}/.install.tar.gz ${F50MGR_DIR}/.install.pkg
if [ ! -f "${APP_FILES}/${zipUrl}" ]; then echo 'ZIP_MISSING'; exit 1; fi
mv -f "${APP_FILES}/${zipUrl}" ${F50MGR_DIR}/.install.pkg
MAGIC=$(head -c 2 ${F50MGR_DIR}/.install.pkg 2>/dev/null | od -An -tx1 | tr -d ' \\n')
if [ "$MAGIC" = "1f8b" ]; then
  mv -f ${F50MGR_DIR}/.install.pkg ${F50MGR_DIR}/.install.tar.gz
  mkdir -p ${F50MGR_DIR}/.install
  tar -xzf ${F50MGR_DIR}/.install.tar.gz -C ${F50MGR_DIR}/.install 2>/dev/null || { echo 'UNPACK_FAIL'; exit 1; }
else
  mv -f ${F50MGR_DIR}/.install.pkg ${F50MGR_DIR}/.install.zip
  unzip -o -q ${F50MGR_DIR}/.install.zip -d ${F50MGR_DIR}/.install 2>/dev/null || { echo 'UNPACK_FAIL'; exit 1; }
fi
[ -f ${F50MGR_DIR}/.install/BACKUP.info ] && echo 'PKG_MODE=backup' || echo 'PKG_MODE=install'
`;
    const out0 = await exec(s0);
    if (out0.includes('ZIP_MISSING') || out0.includes('UNPACK_FAIL')) {
      showFail('压缩包无效或不是 f50mgr 组件包', out0);
      return;
    }
    if (out0.includes('PKG_MODE=backup')) {
      await restoreBackup();
      return;
    }
    // 段 1：劫持 Magisk 启动脚本（组件包安装流程）
    const s1 = `
mkdir -p ${F50MGR_DIR}/data/orig_scripts
find ${F50MGR_DIR}/.install -type f \( -name 'service.sh' -o -name 'post-fs-data.sh' -o -name 'customize.sh' -o -path '*service.d*' -o -path '*post-fs-data.d*' \) 2>/dev/null | while IFS= read -r f; do
  dest="\${f#${F50MGR_DIR}/.install/}"
  mkdir -p "${F50MGR_DIR}/data/orig_scripts/$(dirname "$dest")"
  mv -f "$f" "${F50MGR_DIR}/data/orig_scripts/$dest" 2>/dev/null
  echo "HIJACKED $dest"
done
if [ ! -f ${F50MGR_DIR}/.install/bin/f50mgr ]; then echo 'NO_CORE'; exit 1; fi
echo 'DONE1'
`;
    const out1 = await exec(s1);
    if (out1.includes('NO_CORE')) {
      showFail('压缩包无效或不是 f50mgr 组件包', out1);
      return;
    }
    const hijacked = out1
      .split('\n')
      .filter((l) => l.startsWith('HIJACKED '))
      .map((l) => l.replace('HIJACKED ', ''));
    // 段 2：部署内核 + 面板
    const s2 = `
cp -f ${F50MGR_DIR}/.install/bin/f50mgr ${F50MGR_BIN}
chmod 755 ${F50MGR_BIN}
[ -x ${F50MGR_BIN} ] || { echo 'CORE_DEPLOY_FAIL'; exit 1; }
[ -f ${F50MGR_DIR}/bin/mihomo ] || cp -f ${F50MGR_DIR}/.install/bin/mihomo.fallback ${F50MGR_DIR}/bin/mihomo
chmod 755 ${F50MGR_DIR}/bin/mihomo
[ -f ${F50MGR_DIR}/bin/mihomo ] || { echo 'MIHOMO_DEPLOY_FAIL'; exit 1; }
cp -f ${F50MGR_DIR}/.install/bin/easytier.fallback ${F50MGR_DIR}/bin/easytier
cp -f ${F50MGR_DIR}/.install/bin/easytier-cli.fallback ${F50MGR_DIR}/bin/easytier-cli
chmod 755 ${F50MGR_DIR}/bin/easytier ${F50MGR_DIR}/bin/easytier-cli
rm -rf ${F50MGR_DIR}/config/clash/dashboard
mkdir -p ${F50MGR_DIR}/config/clash/dashboard
tar -xzf ${F50MGR_DIR}/.install/assets/zashboard.tar.gz -C ${F50MGR_DIR}/config/clash/dashboard 2>/dev/null || echo 'DASH_FAIL'
echo 'DONE2'
`;
    const out2 = await exec(s2);
    if (
      out2.includes('CORE_DEPLOY_FAIL') ||
      out2.includes('MIHOMO_DEPLOY_FAIL')
    ) {
      showFail('内核部署失败', out2);
      return;
    }
    // 段 3：默认配置 + watch 守护脚本 + 管理密钥 + 自启行
    const s3 = `
if [ ! -f ${F50MGR_TOML} ]; then cat > ${F50MGR_TOML} <<'TOML_EOF'
[mihomo]
auto_start = true
version_check_interval = "6h"

[download]
github_timeout_secs = 30

[web]
listen = "192.168.0.1:14180"

[iptables]
auto_enable = true
block_lan_ipv6 = true

[easytier]
enabled = false
TOML_EOF
chmod 644 ${F50MGR_TOML}; fi
if [ ! -f ${F50MGR_SECRETS} ]; then cat > ${F50MGR_SECRETS} <<'SEC_EOF'
[subscription]
url = ""
SEC_EOF
chmod 600 ${F50MGR_SECRETS}; fi
cat > ${F50MGR_WATCH} <<'WATCH_EOF'
#!/system/bin/sh
F50MGR_DATA_DIR=/data/adb/f50mgr
F50MGR_BIN="$F50MGR_DATA_DIR/bin/f50mgr"
LOCK="$F50MGR_DATA_DIR/run/watch.pid"
mkdir -p "$F50MGR_DATA_DIR/run"
if [ -f "$LOCK" ]; then
    OLDPID=$(cat "$LOCK" 2>/dev/null)
    if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') f50mgr: watch already running pid=$OLDPID, exit" >> "$F50MGR_DATA_DIR/run/f50mgr.log"
        exit 0
    fi
fi
echo $$ > "$LOCK"
while :; do
    "$F50MGR_BIN" daemon
    rc=$?
    echo "$(date '+%Y-%m-%d %H:%M:%S') f50mgr: daemon exited rc=$rc, restarting in 5s" >> "$F50MGR_DATA_DIR/run/f50mgr.log"
    sleep 5
done
WATCH_EOF
chmod 755 ${F50MGR_WATCH}
[ -f ${F50MGR_WATCH} ] || { echo 'WATCH_DEPLOY_FAIL'; exit 1; }
AUTH_OUT="$(timeout 10 ${F50MGR_BIN} auth ensure 2>&1 || echo 'AUTH_TIMEOUT')"
echo "$AUTH_OUT" > ${AUTH_FILE}
chmod 600 ${AUTH_FILE}
# 注意：导入不自动写入开机自启。开机自启由面板「开机自启」滑块单独控制（默认关闭）
echo '---AUTH---'
cat ${AUTH_FILE}
echo 'DONE3'
`;
    const out3 = await exec(s3);
    if (out3.includes('WATCH_DEPLOY_FAIL')) {
      showFail('守护脚本部署失败', out3);
      return;
    }
    const auth = (out3.match(/---AUTH---[\s\S]*DONE3/) || [''])[0]
      .replace('---AUTH---', '')
      .replace('DONE3', '')
      .trim();
    // 段 4：清理旧进程 + 拉起守护循环 + 拉起 daemon
    const s4 = `
rm -rf ${F50MGR_DIR}/.install ${F50MGR_DIR}/.install.zip ${F50MGR_DIR}/.install.tar.gz ${F50MGR_DIR}/.install.pkg
pkill -9 -f 'f50mgr-watch.sh' 2>/dev/null
pkill -9 -f 'f50mgr daemon' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/mihomo' 2>/dev/null
rm -f ${F50MGR_DIR}/run/watch.pid ${F50MGR_DIR}/run/f50mgr.pid
sleep 2
nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
# daemon 由 watch 后台拉起；只快速确认进程存在（最多 3 秒），Web 就绪由状态面板跟进
UP=''
i=0
while [ $i -lt 3 ]; do
  if pgrep -f 'f50mgr daemon' >/dev/null 2>&1; then
    UP=1
    break
  fi
  sleep 1
  i=$((i+1))
done
if [ -n "$UP" ]; then
  pgrep -f 'f50mgr daemon' | head -1
else
  echo 'DAEMON_NOT_UP'
  echo '---DIAG---'
  tail -n 20 ${F50MGR_DIR}/run/f50mgr.log 2>/dev/null || echo 'no-log'
  netstat -tlnp 2>/dev/null | grep -E ':(14180|14191|14192|14193)' || echo 'no-listen'
  pgrep -af 'f50mgr|mihomo|easytier' || echo 'no-procs'
fi
`;
    const out4 = await exec(s4);
    const pid = out4
      .split('\n')
      .filter((l) => /^\d+$/.test(l.trim()))
      .pop();
    if (pid) {
      createToast(
        hijacked.length
          ? `安装成功，已劫持 ${hijacked.length} 个自启脚本`
          : `安装成功，daemon 启动中 (PID ${pid})`,
      );
      if (hijacked.length) {
        showTextDialog(
          'f50mgr_hijack',
          '已劫持的启动文件（未落系统自启目录）',
          hijacked.join('\n') +
            '\n\n以上文件已移入 ' +
            F50MGR_DIR +
            '/data/orig_scripts/ 存档，开机完全由插件接管。',
        );
      }
      if (auth) showTextDialog('f50mgr_auth', '管理密钥', auth);
      refreshRunning();
    } else {
      createToast('已安装，但 daemon 未拉起，请查看诊断', 'red');
      showTextDialog(
        'f50mgr_log',
        '安装输出（诊断）',
        (out4.split('---DIAG---')[1] || out4).slice(0, 3000),
      );
    }
  };

  // ============ 备份还原 ============
  // 还原备份包：全量恢复内核/配置/密钥/劫持存档/自启状态，并重启 daemon
  const restoreBackup = async () => {
    const exec = async (script) => {
      const res = await runShellWithRoot(script);
      return (res && res.content) || '';
    };
    const showFail = (tag, out) => {
      createToast('还原失败：' + tag, 'red');
      showTextDialog('f50mgr_log', '还原失败详情', (out || '').slice(0, 3000));
    };
    // 段 R1：停进程 + 还原内核/配置/劫持存档/密钥
    const r1 = `
pkill -9 -f 'f50mgr-watch.sh' 2>/dev/null
pkill -9 -f 'f50mgr daemon' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/mihomo' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/easytier' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/easytier-cli' 2>/dev/null
sleep 1
rm -f ${F50MGR_DIR}/run/watch.pid ${F50MGR_DIR}/run/f50mgr.pid
# —— 内核（按备份内容覆盖）——
if [ -f ${F50MGR_DIR}/.install/bin/f50mgr ]; then
  cp -f ${F50MGR_DIR}/.install/bin/f50mgr ${F50MGR_BIN}
  chmod 755 ${F50MGR_BIN}
  echo 'RST_BIN f50mgr'
fi
if [ -f ${F50MGR_DIR}/.install/bin/mihomo ]; then
  cp -f ${F50MGR_DIR}/.install/bin/mihomo ${F50MGR_DIR}/bin/mihomo
  chown root:net_admin ${F50MGR_DIR}/bin/mihomo 2>/dev/null
  chmod 755 ${F50MGR_DIR}/bin/mihomo
  chcon u:object_r:adb_data_file:s0 ${F50MGR_DIR}/bin/mihomo 2>/dev/null || true
  echo 'RST_BIN mihomo'
fi
if [ -f ${F50MGR_DIR}/.install/bin/easytier ]; then
  cp -f ${F50MGR_DIR}/.install/bin/easytier ${F50MGR_DIR}/bin/easytier
  chmod 755 ${F50MGR_DIR}/bin/easytier
  echo 'RST_BIN easytier'
fi
if [ -f ${F50MGR_DIR}/.install/bin/easytier-cli ]; then
  cp -f ${F50MGR_DIR}/.install/bin/easytier-cli ${F50MGR_DIR}/bin/easytier-cli
  chmod 755 ${F50MGR_DIR}/bin/easytier-cli
  echo 'RST_BIN easytier-cli'
fi
[ -x ${F50MGR_BIN} ] || { echo 'CORE_RESTORE_FAIL'; exit 1; }
# —— 配置（覆盖还原）——
rm -rf ${F50MGR_DIR}/config/clash ${F50MGR_DIR}/config/easytier
mkdir -p ${F50MGR_DIR}/config/clash ${F50MGR_DIR}/config/easytier
if [ -f ${F50MGR_DIR}/.install/config/f50mgr.toml ]; then
  cp -f ${F50MGR_DIR}/.install/config/f50mgr.toml ${F50MGR_TOML}
  chmod 644 ${F50MGR_TOML}
  echo 'RST_CFG f50mgr.toml'
fi
if [ -f ${F50MGR_DIR}/.install/config/secrets.toml ]; then
  cp -f ${F50MGR_DIR}/.install/config/secrets.toml ${F50MGR_SECRETS}
  chmod 600 ${F50MGR_SECRETS}
  echo 'RST_CFG secrets.toml'
fi
[ -f ${F50MGR_DIR}/.install/config/custom_rules.txt ] && cp -f ${F50MGR_DIR}/.install/config/custom_rules.txt ${F50MGR_DIR}/config/custom_rules.txt && echo 'RST_CFG custom_rules.txt'
[ -f ${F50MGR_DIR}/.install/config/schedule.json ] && cp -f ${F50MGR_DIR}/.install/config/schedule.json ${F50MGR_DIR}/config/schedule.json && echo 'RST_CFG schedule.json'
[ -f ${F50MGR_DIR}/.install/config/subscriptions.json ] && cp -f ${F50MGR_DIR}/.install/config/subscriptions.json ${F50MGR_DIR}/config/subscriptions.json && echo 'RST_CFG subscriptions.json'
[ -f ${F50MGR_DIR}/.install/config/rulesets.json ] && cp -f ${F50MGR_DIR}/.install/config/rulesets.json ${F50MGR_DIR}/config/rulesets.json && echo 'RST_CFG rulesets.json'
[ -d ${F50MGR_DIR}/.install/config/rules ] && { mkdir -p ${F50MGR_DIR}/config/rules && cp -rf ${F50MGR_DIR}/.install/config/rules/. ${F50MGR_DIR}/config/rules/ && echo 'RST_CFG rules'; }
[ -f ${F50MGR_DIR}/.install/config/clash/config.yaml ] && cp -f ${F50MGR_DIR}/.install/config/clash/config.yaml ${F50MGR_DIR}/config/clash/config.yaml
[ -d ${F50MGR_DIR}/.install/config/clash/dashboard ] && cp -rf ${F50MGR_DIR}/.install/config/clash/dashboard ${F50MGR_DIR}/config/clash/dashboard
[ -d ${F50MGR_DIR}/.install/config/easytier ] && cp -rf ${F50MGR_DIR}/.install/config/easytier/. ${F50MGR_DIR}/config/easytier/
# —— 劫持脚本存档 ——
rm -rf ${F50MGR_DIR}/data/orig_scripts
if [ -d ${F50MGR_DIR}/.install/data/orig_scripts ]; then
  mkdir -p ${F50MGR_DIR}/data/orig_scripts
  cp -rf ${F50MGR_DIR}/.install/data/orig_scripts/. ${F50MGR_DIR}/data/orig_scripts/
  echo 'RST_DATA orig_scripts'
fi
# —— 管理密钥 / 日志 ——
if [ -f ${F50MGR_DIR}/.install/run/.auth_secret ]; then
  cp -f ${F50MGR_DIR}/.install/run/.auth_secret ${AUTH_FILE}
  chmod 600 ${AUTH_FILE}
  echo 'RST_AUTH file'
fi
[ -f ${F50MGR_DIR}/.install/run/f50mgr.log ] && cp -f ${F50MGR_DIR}/.install/run/f50mgr.log ${F50MGR_LOG} 2>/dev/null
echo 'R1_DONE'
`;
    const out1 = await exec(r1);
    if (out1.includes('CORE_RESTORE_FAIL')) {
      showFail('备份包缺少 f50mgr 内核', out1);
      return;
    }
    // 段 R2：同步管理密钥 + 开机自启状态 + 守护脚本 + 拉起 daemon
    const r2 = `
# 管理密钥：若 f50mgr 识别不到备份密钥才重新生成并回写；能识别则保留备份原密钥
AUTH_OUT="$(timeout 10 ${F50MGR_BIN} auth ensure 2>&1 || echo 'AUTH_TIMEOUT')"
case "$AUTH_OUT" in
  created=*) echo "$AUTH_OUT" > ${AUTH_FILE}; chmod 600 ${AUTH_FILE}; echo "AUTH_CREATED $AUTH_OUT" ;;
  *) echo 'AUTH_EXISTING' ;;
esac
# 开机自启状态（按备份时记录恢复）
BOOT=$(sed -n 's/^BOOT=//p' ${F50MGR_DIR}/.install/BACKUP.info 2>/dev/null | head -1)
if [ "$BOOT" = "ON" ]; then
  grep -qxF '${BOOT_LINE}' ${BOOT_FILE} 2>/dev/null || echo '${BOOT_LINE}' >> ${BOOT_FILE}
  echo "BOOT=ON"
else
  sed -i "\\|^${BOOT_LINE}$|d" ${BOOT_FILE} 2>/dev/null
  echo "BOOT=OFF"
fi
# 守护脚本（与安装一致，重新部署，保证可用）
cat > ${F50MGR_WATCH} <<'WATCH_EOF'
#!/system/bin/sh
F50MGR_DATA_DIR=/data/adb/f50mgr
F50MGR_BIN="$F50MGR_DATA_DIR/bin/f50mgr"
LOCK="$F50MGR_DATA_DIR/run/watch.pid"
mkdir -p "$F50MGR_DATA_DIR/run"
if [ -f "$LOCK" ]; then
    OLDPID=$(cat "$LOCK" 2>/dev/null)
    if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') f50mgr: watch already running pid=$OLDPID, exit" >> "$F50MGR_DATA_DIR/run/f50mgr.log"
        exit 0
    fi
fi
echo $$ > "$LOCK"
fail=0
while :; do
    "$F50MGR_BIN" daemon
    rc=$?
    if [ "$rc" = "0" ]; then fail=0; fi
    if [ "$rc" != "0" ]; then fail=$((fail+1)); fi
    W=5; [ "$fail" -ge 3 ] && W=30
    echo "$(date '+%Y-%m-%d %H:%M:%S') f50mgr: daemon exited rc=$rc (fail=$fail), restarting in ${W}s" >> "$F50MGR_DATA_DIR/run/f50mgr.log"
    sleep "$W"
done
WATCH_EOF
chmod 755 ${F50MGR_WATCH}
[ -f ${F50MGR_WATCH} ] || { echo 'WATCH_DEPLOY_FAIL'; exit 1; }
# 清理临时文件 + 拉起守护循环
rm -rf ${F50MGR_DIR}/.install ${F50MGR_DIR}/.install.zip ${F50MGR_DIR}/.install.tar.gz ${F50MGR_DIR}/.install.pkg
nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
# daemon 由 watch 后台拉起；只快速确认进程存在（最多 3 秒），Web 就绪由状态面板跟进
UP=''
i=0
while [ $i -lt 3 ]; do
  if pgrep -f 'f50mgr daemon' >/dev/null 2>&1; then
    UP=1
    break
  fi
  sleep 1
  i=$((i+1))
done
if [ -n "$UP" ]; then
  echo 'R2_UP'
  pgrep -f 'f50mgr daemon' | head -1
else
  echo 'DAEMON_NOT_UP'
  echo '---DIAG---'
  tail -n 20 ${F50MGR_LOG} 2>/dev/null || echo 'no-log'
fi
`;
    const out2 = await exec(r2);
    if (out2.includes('WATCH_DEPLOY_FAIL')) {
      showFail('守护脚本部署失败', out2);
      return;
    }
    const restored = out1
      .split('\n')
      .filter((l) => l.startsWith('RST_'))
      .join('\n');
    const authCreated = (out2.match(/AUTH_CREATED (created=\S+)/) || [])[1] || '';
    const boot = out2.includes('BOOT=ON')
      ? 'ON（开机自启）'
      : out2.includes('BOOT=OFF')
        ? 'OFF'
        : '?';
    const pid = out2
      .split('\n')
      .filter((l) => /^\d+$/.test(l.trim()))
      .pop();
    if (out2.includes('R2_UP')) {
      createToast(`还原成功，daemon 已运行 (PID ${pid})`);
      let msg =
        `已还原：\n${restored || '（全部数据）'}\n\n开机自启：${boot}\ndaemon：运行中 (PID ${pid})`;
      msg += authCreated
        ? `\n\n⚠ 管理密钥已重新生成（备份密钥未被识别）：\n${authCreated}\nWeb 面板登录请用新密钥。`
        : '\n\n管理密钥：已按备份恢复，Web 面板可继续用原密钥。';
      showTextDialog('f50mgr_rst_res', '还原完成', msg);
      refreshRunning();
      checkIsBootUp().then((on) => updateBootStyle(bootBtn.el, on));
      // 还原后按备份的定时配置重新部署定时守护
      readSchedule().then(async (sched) => { await ensureSched(sched); });
    } else {
      createToast('还原完成，但 daemon 未拉起，请查看诊断', 'red');
      showTextDialog(
        'f50mgr_log',
        '还原输出（诊断）',
        (out2.split('---DIAG---')[1] || out2).slice(0, 3000),
      );
    }
  };

  const startF50 = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    if (await isDaemonRunning()) {
      createToast('f50mgr 已经在运行中');
      return;
    }
    const res = await runShellWithRoot(`
pkill -f 'f50mgr-watch.sh' 2>/dev/null
pkill -f 'f50mgr daemon' 2>/dev/null
sleep 2
nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
sleep 3
pgrep -f 'f50mgr daemon' | head -1 || echo 'NOT_UP'
`);
    const out = (res.content || '').trim();
    if (/^\d+$/.test(out)) {
      createToast(`已启动 (PID ${out})`);
      refreshRunning();
    } else {
      createToast('启动失败，请查看日志', 'red');
      showTextDialog('f50mgr_log', '启动输出', out);
    }
  };

  const stopF50 = async () => {
    if (!(await isDaemonRunning()) && !(await checkIsBootUp())) {
      createToast('f50mgr 未在运行');
      return;
    }
    const res = await runShellWithRoot(`
pkill -f 'f50mgr-watch.sh' 2>/dev/null
pkill -f 'f50mgr daemon' 2>/dev/null
# 给 daemon 时间自行撤销 iptables/清理 mihomo 后退出
sleep 4
if pgrep -f 'f50mgr daemon' >/dev/null 2>&1; then
  pkill -9 -f 'f50mgr daemon' 2>/dev/null
  pkill -9 -f 'f50mgr-watch.sh' 2>/dev/null
  sleep 1
fi
# 兜底清理残留内核进程（正常退出时 daemon 已带它们退出）
pkill -9 -f '${F50MGR_DIR}/bin/mihomo' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/easytier' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/easytier-cli' 2>/dev/null
sleep 1
N=$(pgrep -f 'f50mgr daemon' | wc -l)
if [ "$N" = "0" ]; then echo 'STOPPED'; else echo 'STILL_UP'; pgrep -af 'f50mgr daemon'; fi
`);
    const out = (res.content || '').trim();
    if (out.includes('STILL_UP')) {
      createToast('停止失败：进程仍存在，请查看日志', 'red');
      showTextDialog('f50mgr_log', '停止失败详情', out);
    } else {
      createToast('已停止（TPROXY 规则已撤销）');
      refreshRunning();
    }
  };

  const restartF50 = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const res = await runShellWithRoot(`
pkill -f 'f50mgr-watch.sh'
pkill -f 'f50mgr daemon'
sleep 2
nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
sleep 3
pgrep -f 'f50mgr daemon' | head -1 || echo 'NOT_UP'
`);
    const out = (res.content || '').trim();
    if (/^\d+$/.test(out)) {
      createToast(`已重启 (PID ${out})`);
      refreshRunning();
    } else {
      createToast('重启失败，请查看日志', 'red');
      showTextDialog('f50mgr_log', '重启输出', out);
    }
  };

  const showStatus = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const res = await runShellWithRoot(`
echo '—— 守护循环(watch)数量 ——'
pgrep -f 'f50mgr-watch.sh' | wc -l
echo '—— daemon ——'
pgrep -f 'f50mgr daemon' | head -1 || echo 'not running'
echo '—— mihomo ——'
pgrep -f '${F50MGR_DIR}/bin/mihomo' | head -1 || echo 'not running'
echo '—— f50mgr status ——'
${F50MGR_BIN} status 2>&1 | head -30
echo '—— Web :${UI_PORT} ——'
netstat -tlnp 2>/dev/null | grep ':${UI_PORT}' || echo 'not listening'
echo '—— 最近日志 ——'
tail -n 8 ${F50MGR_LOG} 2>/dev/null || echo '(无日志)'
`);
    showTextDialog('f50mgr_status', 'f50mgr 运行状态', res.content);
  };

  const showAuth = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const res = await runShellWithRoot(
      `cat ${AUTH_FILE} 2>/dev/null; echo; ${F50MGR_BIN} auth ensure 2>&1; echo; ls -la ${F50MGR_DIR}/config/ ${F50MGR_DIR}/data/ 2>/dev/null`,
    );
    const out = (res.content || '').trim();
    const created = out.match(/created=(\S+)/);
    if (created) {
      showTextDialog(
        'f50mgr_auth',
        '管理密钥（Web/Mihomo 共用）',
        '密钥：' + created[1] + '\n\n（已写入 ' + AUTH_FILE + '，供面板登录使用）',
      );
      return;
    }
    showTextDialog(
      'f50mgr_auth',
      '管理密钥（Web/Mihomo 共用）',
      out +
        '\n\nf50mgr 出于安全设计，密钥已存在时不会回显（返回 existing）。\n如需获取新密钥，请点「重置密钥」，新密钥会在此弹窗显示。',
    );
  };

  const resetAuth = async () => {
    if (!(await askConfirm('f50mgr_auth_reset', '重置管理密钥？', '重置后旧密钥立即失效，Web 面板和 Mihomo external-controller 都改用新密钥。'))) return;
    const res = await runShellWithRoot(`
${F50MGR_BIN} auth reset 2>&1
${F50MGR_BIN} auth ensure 2>&1
`);
    if (res.content && res.content.trim()) {
      await runShellWithRoot(
        `echo "${res.content.trim()}" > ${AUTH_FILE}; chmod 600 ${AUTH_FILE}`,
      );
    }
    showTextDialog('f50mgr_auth', '新管理密钥', res.content || '(无输出)');
  };

  // 订阅设置：查看/修改 f50mgr 订阅地址（secrets.toml [subscription] url）
  // 用于修复「订阅更新失败 / 下载内容过小 / token is null」——通常是订阅地址丢了 token 或 token 已过期
  const toggleBoot = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const on = await checkIsBootUp();
    // 猫猫同款：写/删 boot.sh 钩子行（UFI 平台开机执行，不依赖 Magisk）；关闭时同时杀掉当前 watch/daemon 防止内存复活
    const res = await runShellWithRoot(
      on
        ? `sed -i "\\|^${BOOT_LINE}$|d" ${BOOT_FILE} 2>/dev/null; sed -i "\\|^${SCHED_LINE}$|d" ${BOOT_FILE} 2>/dev/null; pkill -f 'f50mgr-watch.sh' 2>/dev/null; pkill -f 'f50mgr daemon' 2>/dev/null; pkill -f 'f50mgr-sched.sh' 2>/dev/null; echo OFF`
        : `grep -qxF '${BOOT_LINE}' ${BOOT_FILE} 2>/dev/null || echo '${BOOT_LINE}' >> ${BOOT_FILE}; echo ON`,
    );
    createToast(
      res.content.includes('ON') ? '已开启开机自启（boot.sh 钩子，不依赖 Magisk）' : '已关闭开机自启（定时任务一并停止）',
      res.content.includes('ON') ? '' : 'red',
    );
  };

  const openUI = async () => {
    const ip = await detectMgrIp();
    const a = document.createElement('a');
    a.href = webUI(ip) + '?t=' + Date.now();
    a.target = '_blank';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 延迟面板渲染：国内直连 / 国外代理 延迟 + 出口 IP 归属（插件自测，不依赖 f50mgr API）
  const renderLat = (baidu, qq, n163, google, yt, x, note = '', geoP = '', geoD = '') => {
    const set = (id, text, ok) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.style.color = ok === null ? '' : ok ? '#22c55e' : '#ef4444';
    };
    const ms = (v) => (v == null ? '--' : v < 1 ? '<1 ms' : `${v} ms`);
    const ok = (v) => v != null;
    const dom = [baidu, qq, n163].filter((v) => v != null);
    const frn = [google, yt, x].filter((v) => v != null);
    set(
      'lat_dom',
      ms(dom.length ? Math.round(dom.reduce((a, b) => a + b, 0) / dom.length) : null),
      !!dom.length,
    );
    set(
      'lat_frn',
      ms(frn.length ? Math.round(frn.reduce((a, b) => a + b, 0) / frn.length) : null),
      !!frn.length,
    );
    set('lat_baidu', ms(baidu), ok(baidu));
    set('lat_qq', ms(qq), ok(qq));
    set('lat_163', ms(n163), ok(n163));
    set('lat_google', ms(google), ok(google));
    set('lat_yt', ms(yt), ok(yt));
    set('lat_x', ms(x), ok(x));
    set('lat_note', note || '', null);
    const ge = document.getElementById('lat_geo');
    if (ge) {
      const fmt = (s) => {
        const i = s.indexOf('|');
        const ip = i > 0 ? s.slice(0, i) : s;
        const rest = i > 0 ? s.slice(i + 1) : '';
        return ip ? (rest ? ip + '（' + rest + '）' : ip) : '';
      };
      const parts = [];
      if (geoP) parts.push('🌐 代理出口：' + escHtml(fmt(geoP)));
      if (geoD) parts.push('🏠 直连出口：' + escHtml(fmt(geoD)));
      ge.innerHTML = parts.join('　') || '';
    }
  };

  // 刷新延迟面板：6 站全部经 LAN 侧 IP + mihomo HTTP 入站探测（规则分流：国内 DIRECT / 国外走节点，与真实上网同链路），入站不可用时回退直连
  const refreshLatency = async () => {
    const box = document.getElementById('f50mgr_latency');
    if (!box) return;
    const res = await runShellWithRoot(`IP=$(netstat -tlnp 2>/dev/null | awk '/:14180 / && /LISTEN/{print $4; exit}' | sed 's/:[0-9]*$//')
[ -n "$IP" ] || IP=192.168.0.1
T=${F50MGR_DIR}/run
CFG=${F50MGR_DIR}/config/clash/config.yaml
EC=$(grep '^external-controller:' "$CFG" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '"')
[ -z "$EC" ] && EC=$IP:14193
SECRET=$(grep -E '^secret:' "$CFG" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '"')
A1=""; A2=""
[ -n "$SECRET" ] && { A1="-H"; A2="Authorization: Bearer $SECRET"; }
# 候选入站端口逐个实测（mixed-port/port/socks-port × http/socks5，各 2s），只用真实可用端口，绝不改写 config.yaml
PXY=""
for PT in $(grep -E '^(mixed-port|port|socks-port):' "$CFG" 2>/dev/null | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d ' ' | tr '\\n' ' '); do
  [ -n "$PT" ] || continue
  if curl -m 2 -s -o /dev/null -x "http://$IP:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="http://$IP:$PT"; break; fi
  if curl -m 2 -s -o /dev/null -x "socks5h://$IP:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="socks5h://$IP:$PT"; break; fi
done
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
# 原始链接方式：所有站点先经 mihomo 代理测（8s），代理失败再直连兜底（8s）；PXY 为空则直连
t() {
  r=$(curl -m 8 -A "$UA" -x "$PXY" -o /dev/null -s -w '%{http_code} %{time_total}' "$1" 2>/dev/null)
  c=\${r%% *}
  if [ -z "$r" ] || [ "$c" = "000" ]; then
    r2=$(curl -m 8 -A "$UA" -o /dev/null -s -w '%{http_code} %{time_total}' "$1" 2>/dev/null)
    c2=\${r2%% *}
    if [ -z "$r2" ] || [ "$c2" = "000" ]; then echo X; else echo "D $r2"; fi
  else
    echo "P $r"
  fi
}
t http://www.baidu.com/ > "$T/.l1" 2>&1 &
t http://www.qq.com/ > "$T/.l2" 2>&1 &
t https://www.163.com/robots.txt > "$T/.l3" 2>&1 &
t https://www.google.com/generate_204 > "$T/.l4" 2>&1 &
t https://www.youtube.com/generate_204 > "$T/.l5" 2>&1 &
t https://x.com/favicon.ico > "$T/.l6" 2>&1 &
wait
# 出口 IP 归属：代理（经 mihomo 入站）/ 直连（国内服务）
if [ -n "$PXY" ]; then
  GP=$(curl -m 6 -A "$UA" -x "$PXY" -s 'http://ip-api.com/json/?fields=status,country,regionName,isp,query&lang=zh-CN' 2>/dev/null)
  [ -z "$GP" ] && GP=$(curl -m 6 -A "$UA" -x "$PXY" -s 'https://api.ip.sb/geoip' 2>/dev/null)
  GPI=$(printf '%s' "$GP" | sed -n 's/.*"query":"\\\([^"]*\\\)".*/\\1/p' | head -1)
  GPC=$(printf '%s' "$GP" | sed -n 's/.*"country":"\\\([^"]*\\\)".*/\\1/p' | head -1)
  GPR=$(printf '%s' "$GP" | sed -n 's/.*"regionName":"\\\([^"]*\\\)".*/\\1/p' | head -1)
  GPO=$(printf '%s' "$GP" | sed -n 's/.*"isp":"\\\([^"]*\\\)".*/\\1/p' | head -1)
  [ -n "$GPI" ] && echo "GEO_P|$GPI|$GPC $GPR $GPO"
fi
GD=$(curl -m 6 -A "$UA" -s 'https://qifu-api.baidubce.com/ip/local/geo/v1/district' 2>/dev/null)
GDI=$(printf '%s' "$GD" | sed -n 's/.*"ip":"\\\([^"]*\\\)".*/\\1/p' | head -1)
GDP=$(printf '%s' "$GD" | sed -n 's/.*"prov":"\\\([^"]*\\\)".*/\\1/p' | head -1)
GDO=$(printf '%s' "$GD" | sed -n 's/.*"isp":"\\\([^"]*\\\)".*/\\1/p' | head -1)
if [ -z "$GDI" ]; then
  MI=$(curl -m 6 -A "$UA" -s 'https://myip.ipip.net' 2>/dev/null)
  GDI=$(printf '%s' "$MI" | sed -n 's/.*当前 IP：\\\([^ ]*\\\) .*/\\1/p' | head -1)
  GDM=$(printf '%s' "$MI" | sed -n 's/.*来自于：\\\(.*\\\)$/\\1/p' | head -1)
  [ -n "$GDI" ] && echo "GEO_D|$GDI|$GDM"
fi
[ -n "$GDI" ] && echo "GEO_D|$GDI|$GDP $GDO"
echo "R $(cat "$T/.l1") | $(cat "$T/.l2") | $(cat "$T/.l3") | $(cat "$T/.l4") | $(cat "$T/.l5") | $(cat "$T/.l6")"
rm -f "$T/.l1" "$T/.l2" "$T/.l3" "$T/.l4" "$T/.l5" "$T/.l6"
`);
    const m = ((res.content || '').match(/R ([\s\S]*)$/) || [])[1] || '';
    const parts = m.split('|').map((s) => s.trim());
    const parsePlain = (s) => {
      if (!s) return null;
      const sp = s.replace(/^(P|D)\s+/, '').split(/\s+/);
      const code = parseInt(sp[0], 10);
      if (Number.isNaN(code) || code < 200 || code >= 400 || !sp[1]) return null;
      const ms = Math.round(parseFloat(sp[1]) * 1000);
      return Number.isFinite(ms) ? ms : null;
    };
    const b = parsePlain(parts[0]);
    const q = parsePlain(parts[1]);
    const n163 = parsePlain(parts[2]);
    const g = parsePlain(parts[3]);
    const yt = parsePlain(parts[4]);
    const x = parsePlain(parts[5]);
    const pCnt = parts.filter((s) => /^P /.test(s || '')).length;
    const dCnt = parts.filter((s) => /^D /.test(s || '')).length;
    const anyD = b != null || q != null || n163 != null;
    const anyF = g != null || yt != null || x != null;
    const note = anyD
      ? anyF
        ? '国内直连 · 国外经代理可用'
        : '国内直连正常；国外节点全部不可用（机场/订阅问题）'
      : '国内直连不可测（网络异常？）';
    const geoP = (((res.content || '').match(/GEO_P\|([^\n]*)/) || [])[1] || '').trim();
    const geoD = (((res.content || '').match(/GEO_D\|([^\n]*)/) || [])[1] || '').trim();
    renderLat(b, q, n163, g, yt, x, note, geoP, geoD);
  };

  // 手动更新 mihomo 内核：GitHub 官方拉最新 arm64 → 校验 → 替换 → 重启 daemon
  // 手动更新 mihomo 内核（两阶段）：
  // 阶段1：写入下载脚本并 nohup 后台下载（服务不中断），状态写入 run/update.status
  // 阶段2：轮询状态，下载+校验 OK 后自动备份→替换→重启 daemon（短脚本避免平台超时）
  // 内核更新公共执行：后台下载（参数化脚本）→ 轮询 → 替换重启
  const runKernelUpdate = async (branch, version, base, el = null) => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const busy = await runShellWithRoot(`grep -s '^STATE=DOWNLOADING$' ${F50MGR_DIR}/run/update.status 2>/dev/null`);
    if (busy.content && busy.content.includes('DOWNLOADING')) {
      createToast('已有更新任务在后台下载中，请稍候', 'red');
      return;
    }
    await deployUpdateScript();
    const B = String(base || '').replace(/["$`\\]/g, '\\$&');
    const V = String(version || 'latest').replace(/["$`\\]/g, '\\$&');
    const BR = branch === 'smart' ? 'smart' : 'stable';
    // 清残留状态（防上次 DOWNLOADING 卡死），setsid 脱离会话防后台进程被杀
    await runShellWithRoot(`rm -f ${F50MGR_DIR}/run/update.status ${F50MGR_DIR}/run/update.log`);
    const start = await runShellWithRoot(`
setsid nohup sh ${F50MGR_DIR}/run/f50mgr-update.sh "${BR}" "${V}" "${B}" > ${F50MGR_DIR}/run/update.log 2>&1 &
echo 'STARTED'
`);
    const sout = (start.content || '').trim();
    if (!sout.includes('STARTED')) {
      createToast('启动下载失败，请查看输出', 'red');
      showTextDialog('f50mgr_uk_res', '启动失败', sout.slice(0, 800));
      return;
    }
    createToast(`已在后台下载（${BR} 分支${version && version !== 'latest' ? ' / ' + version : ''}），完成后由后端自动替换重启`);
    // 全局悬浮进度条（body 层固定底部，弹窗关闭仍可见）
    let gwrap = document.getElementById('f50mgr_um_gprog');
    if (!gwrap) {
      gwrap = document.createElement('div');
      gwrap.id = 'f50mgr_um_gprog';
      gwrap.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;width:min(440px,88vw);background:rgba(8,10,18,.94);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.55);display:none;';
      gwrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span id="f50mgr_um_gtitle" style="font-size:.7rem;font-weight:600;color:#fff;">内核更新中…</span><span id="f50mgr_um_gpct" style="font-size:.7rem;color:#22d3ee;font-weight:600;">5%</span></div><div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;"><div id="f50mgr_um_gbar" style="height:100%;width:5%;border-radius:4px;background:linear-gradient(90deg,#3b82f6,#22d3ee);transition:width .4s;"></div></div><div id="f50mgr_um_gtxt" style="margin-top:5px;font-size:.62rem;color:#9ca3af;text-align:center;word-break:break-all;">准备中…</div>';
      document.body.appendChild(gwrap);
    }
    const setG = (p, txt) => {
      gwrap.style.display = '';
      const bar = document.getElementById('f50mgr_um_gbar');
      const pct = document.getElementById('f50mgr_um_gpct');
      const gtx = document.getElementById('f50mgr_um_gtxt');
      const pp = Math.max(0, Math.min(100, parseInt(p, 10)));
      if (bar) bar.style.width = pp + '%';
      if (pct) pct.textContent = pp + '%';
      if (gtx) gtx.textContent = txt || '';
    };
    const hideG = () => { gwrap.style.display = 'none'; };
    // 立即显示进度条（5% 初始化，弹窗内 + 全局）
    setG(5, '准备中…');
    const wrap0 = el?.querySelector('#um_prog');
    if (wrap0) {
      wrap0.style.display = '';
      const bar0 = el.querySelector('#um_prog_bar');
      const tx0 = el.querySelector('#um_prog_txt');
      if (bar0) bar0.style.width = '5%';
      if (tx0) tx0.textContent = '准备中…';
    }
    // 轮询只做状态展示：后端自替换/清理，弹窗关闭即停止轮询（后台任务由 update.sh 一次性完成）
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 360; i++) {
      await sleep(1000);
      const st = await runShellWithRoot(`cat ${F50MGR_DIR}/run/update.status 2>/dev/null`);
      const s = (st.content || '').trim();
      // 进度条：读 PROGRESS 阶段标记更新 UI（弹窗内 + 全局悬浮条，弹窗关闭仍可见）
      // 状态文件为 append 追加写，高频字段（PROGRESS/DL_BYTES/DL_SPEED）必须取最后一个匹配，
      // 否则永远读到首行 PROGRESS=5，UI 卡死不动。
      const lastVal = (re) => {
        const m = s.match(new RegExp(re.source, 'g'));
        return m ? m[m.length - 1].split('=')[1] : undefined;
      };
      const pv = lastVal(/PROGRESS=\d+/);
      if (pv !== undefined) {
        const p = Math.max(0, Math.min(100, parseInt(pv, 10)));
        const txt = {5:'初始化…',15:'使用本地包',25:'获取版本信息…',35:'查询内核资产…',45:'下载源测速…',55:'下载中…',60:'下载中…',65:'下载中…',70:'下载完成，解压中…',80:'解压完成，校验内核…',90:'替换重启中…',100:'完成'};
        const dl = (s.match(/ASSET=(.*)/) || [])[1];
        const dBytes = lastVal(/DL_BYTES=\d+/);
        const dTotal = lastVal(/DL_TOTAL=\d+/);
        const dSpeed = lastVal(/DL_SPEED=\d+/);
        const fmtSize = (n) => {
          n = parseInt(n, 10) || 0;
          if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
          if (n >= 1024) return Math.round(n / 1024) + ' KB';
          return n + ' B';
        };
        const fmtSpd = (n) => {
          n = parseInt(n, 10) || 0;
          if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB/s';
          if (n >= 1024) return Math.round(n / 1024) + ' KB/s';
          return n + ' B/s';
        };
        let label = txt[p] || ('更新中 ' + p + '%');
        if (dl && p >= 35 && p < 100) label += '｜' + dl;
        if (p >= 50 && p < 70 && dBytes !== undefined) {
          if (dTotal && parseInt(dTotal, 10) > 0) label += ' · ' + fmtSize(dBytes) + '/' + fmtSize(dTotal);
          else label += ' · ' + fmtSize(dBytes);
          if (dSpeed !== undefined) label += ' · ' + fmtSpd(dSpeed);
        }
        setG(p, label);
        if (el && document.body.contains(el)) {
          const bar = el.querySelector('#um_prog_bar');
          const tx = el.querySelector('#um_prog_txt');
          const wrap = el.querySelector('#um_prog');
          if (bar && tx && wrap) {
            wrap.style.display = '';
            bar.style.width = p + '%';
            tx.textContent = label;
            if (p >= 100) setTimeout(() => { if (wrap) wrap.style.display = 'none'; }, 3000);
          }
        }
      }
      if (s.includes('STATE=OK')) {
        const nv = (s.match(/NEW_VERSION=(.*)/) || [])[1] || '';
        const tg = (s.match(/TAG=(.*)/) || [])[1] || '';
        hideG();
        createToast(`内核已更新：${nv || tg}，daemon 已重启`);
        showTextDialog('f50mgr_uk_res', '内核更新完成', `新内核：${nv || tg}\n${s}`);
        // 内核替换后后台静默刷新订阅（不弹窗；429 等限流失败不打扰用户）
        setTimeout(() => {
          runShellWithRoot(`nohup sh -c '${F50MGR_BIN} subscription update >/dev/null 2>&1; ${F50MGR_BIN} reload >/dev/null 2>&1' >/dev/null 2>&1 &`);
        }, 5000);
        return;
      }
      if (s.includes('STATE=FAIL')) {
        const reason = (s.match(/REASON=(.*)/) || [])[1] || 'UNKNOWN';
        const map = {
          NO_TAG: '获取最新版本失败（GitHub API 不通）',
          DL_FAIL: '下载失败（GitHub 受限或网络慢）',
          NOT_GZIP: '下载内容不是有效压缩包（网络返回错误页）',
          GUNZIP_FAIL: '解压失败',
          BIN_INVALID: '下载的内核不可执行',
        };
        hideG();
        createToast((map[reason] || '下载失败') + '，内核未改动', 'red');
        showTextDialog('f50mgr_uk_res', '下载失败', s.slice(0, 1500));
        return;
      }
    }
    hideG();
    createToast('下载超时（约 12 分钟），请检查网络后重试', 'red');
    const fin = await runShellWithRoot(`cat ${F50MGR_DIR}/run/update.status 2>/dev/null`);
    showTextDialog('f50mgr_uk_res', '下载超时', (fin.content || '') || '状态文件为空');
  };

  // 版本更新管理（OpenClash 风格）：分支/版本/多地址延迟/手动包
  const KERNEL_BASES = [
    ['https://github.com/MetaCubeX/mihomo/releases/download', 'GitHub 官方'],
    ['https://gh-proxy.com/https://github.com/MetaCubeX/mihomo/releases/download', 'gh-proxy.com'],
    ['https://ghfast.top/https://github.com/MetaCubeX/mihomo/releases/download', 'ghfast.top'],
    ['https://ghproxy.net/https://github.com/MetaCubeX/mihomo/releases/download', 'ghproxy.net'],
    ['https://gh.api.99988866.xyz/https://github.com/MetaCubeX/mihomo/releases/download', '99988866'],
    ['https://mirror.ghproxy.com/https://github.com/MetaCubeX/mihomo/releases/download', 'mirror.ghproxy'],
  ];
  const updateManager = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    await deployUpdateScript();
    const cur = await runShellWithRoot(`cat ${F50MGR_DIR}/config/update.conf 2>/dev/null`);
    const c = (cur.content || '');
    const branch = (c.match(/^branch=(.*)$/m) || [])[1] || 'stable';
    const version = (c.match(/^version=(.*)$/m) || [])[1] || 'latest';
    const lastBase = (c.match(/^base=(.*)$/m) || [])[1] || KERNEL_BASES[0][0];
    let selBase = lastBase && KERNEL_BASES.some((b) => b[0] === lastBase) ? lastBase : KERNEL_BASES[0][0];
    const { el, close } = createFixedToast(
      'f50mgr_um',
      `<div style="pointer-events:all;width:94vw;max-width:620px;">
      <div class="title" style="margin:0">版本更新（内核）</div>
      <div id="um_cur" style="font-size:.72rem;color:#22c55e;margin-top:6px;">当前内核：读取中…</div>
      <div style="margin-top:6px;font-size:.68rem;line-height:1.7;color:#bbb;">选版本号（列表含 Prerelease-Alpha 等 30 个），在下方列表点「选择」指定下载源，最后点顶部「开始更新」。版本下拉可点「刷新」从 GitHub 拉取列表。</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;font-size:.7rem;color:#eee;">
        <select id="um_ver" style="width:190px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;">
          <option value="latest" ${version === 'latest' ? 'selected' : ''}>latest（最新）</option>
          <option value="Prerelease-Alpha">Prerelease-Alpha</option>
        </select>
        <button id="um_refresh" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;font-size:.66rem;">刷新版本</button>
        <button id="um_go" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(52,120,246,.6);background:rgba(52,120,246,.25);color:#fff;font-size:.7rem;">⬇ 开始更新</button>
      </div>
      <div id="um_prog" style="display:none;margin-top:10px;">
        <div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;">
          <div id="um_prog_bar" style="height:100%;width:0%;border-radius:4px;background:linear-gradient(90deg,#3b82f6,#22d3ee);transition:width .4s;"></div>
        </div>
        <div id="um_prog_txt" style="margin-top:4px;font-size:.66rem;color:#bbb;text-align:center;">准备中…</div>
      </div>
      <div style="margin-top:10px;font-size:.68rem;color:#bbb;">下载源（点「选择」指定，延迟：ms）：</div>
      <div id="um_list" style="margin-top:6px;max-height:42vh;overflow-y:auto;"></div>
      <div style="margin-top:8px;font-size:.62rem;color:#888;">也可本地选 .gz 包直接安装（上传后自动解压替换并重启）。</div>
      <div style="margin-top:8px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
        <button id="um_manual" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;font-size:.66rem;">📂 选择本地包安装</button>
        <button class="ok">关闭</button>
      </div>
    </div>`,
    );
    const verSel = el.querySelector('#um_ver');
    // 拉取版本 tag 列表（单次请求 + 防抖锁，避免连点/重复拉取拉高 CPU；打开弹窗不自动拉取）
    let tagsLock = false;
    const refreshTags = async () => {
      if (tagsLock) { createToast('正在拉取中，请稍候'); return; }
      tagsLock = true;
      (async () => {
        const cv = await runShellWithRoot(`${F50MGR_DIR}/bin/mihomo -v 2>/dev/null | head -1`);
        const cvt = (cv.content || '').trim() || '未知';
        const curEl = el.querySelector('#um_cur');
        if (curEl) curEl.textContent = '当前内核：' + escHtml(cvt) + (cvt.toLowerCase().indexOf('alpha') >= 0 ? '（Alpha-Smart）' : '（Stable）');
      })();
      const old = verSel.value;
      verSel.innerHTML = '<option value="latest">latest（最新）</option><option value="Prerelease-Alpha">Prerelease-Alpha</option><option disabled>拉取中…</option>';
      // 轻量端点：tags 列表（KB 级响应，不拉大 JSON 不拉爆 CPU）；6 源并行
      const apiHosts = [
        'https://gh.api.99988866.xyz/https://api.github.com',
        'https://gh-proxy.com/https://api.github.com',
        'https://ghfast.top/https://api.github.com',
        'https://ghproxy.net/https://api.github.com',
        'https://api.github.com',
        'https://mirror.ghproxy.com/https://api.github.com',
      ];
      let tags = [];
      // 6 源并行直连（单 shell 内子进程并行，总时长 <12s 防平台中止）；失败并行代理兜底
      const r = await runShellWithRoot(`
CFGY=${F50MGR_DIR}/config/clash/config.yaml
D=${F50MGR_DIR}/run
IP=$(netstat -tlnp 2>/dev/null | awk '/:14180 / && /LISTEN/{print $4; exit}' | sed 's/:[0-9]*$//'); [ -n "$IP" ] || IP=192.168.0.1
PXY=""
for PT in $(grep -E '^(mixed-port|port|socks-port):' "$CFGY" 2>/dev/null | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d ' ' | tr '\n' ' '); do
  [ -n "$PT" ] || continue
  if curl -m 1 -s -o /dev/null -x "http://$IP:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="http://$IP:$PT"; break; fi
  if curl -m 1 -s -o /dev/null -x "socks5h://$IP:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="socks5h://$IP:$PT"; break; fi
done
HOSTS="${apiHosts.join(' ')}"
rm -f $D/.rt.*
i=0
for H in $HOSTS; do
  ( T="$(curl -m 6 -s -A "Mozilla/5.0" "$H/repos/MetaCubeX/mihomo/tags?per_page=30" 2>/dev/null)"; [ -n "$T" ] && printf '%s' "$T" > $D/.rt.$i ) &
  i=$((i+1))
done
wait
T="$(cat $D/.rt.* 2>/dev/null | head -c 200000)"
rm -f $D/.rt.*
if [ -z "$T" ] && [ -n "$PXY" ]; then
  i=0
  for H in $HOSTS; do
    ( T="$(curl -m 8 -s -A "Mozilla/5.0" -x "$PXY" "$H/repos/MetaCubeX/mihomo/tags?per_page=30" 2>/dev/null)"; [ -n "$T" ] && printf '%s' "$T" > $D/.rt.$i ) &
    i=$((i+1))
  done
  wait
  T="$(cat $D/.rt.* 2>/dev/null | head -c 200000)"
  rm -f $D/.rt.*
fi
printf '%s' "$T" | grep -o '"name":"[^"]*"' | sed 's/.*:"//; s/"$//' | head -30
`);
        // 只保留版本行（v 开头/Prerelease），过滤错误文本（signal is aborted 等）
        tags = (r.content || '').split('\n').map((s) => s.trim()).filter((s) => /^(v\d|Prerelease)/.test(s));
      // Prerelease-Alpha 固定入列（tags 端点可能不在前 30）
      if (tags.indexOf('Prerelease-Alpha') < 0) tags.unshift('Prerelease-Alpha');

      if (tags.length) {
        verSel.innerHTML = '<option value="latest">latest（最新）</option>' + tags.map((t) => `<option value="${escHtml(t)}" ${t === old ? 'selected' : ''}>${escHtml(t)}</option>`).join('');
        createToast(`已获取 ${tags.length} 个版本`);
      } else {
        verSel.innerHTML = '<option value="latest">latest（最新）</option><option value="Prerelease-Alpha">Prerelease-Alpha</option>';
        createToast('拉取版本列表失败（GitHub API 不通），可用 latest 或 Prerelease-Alpha', 'red');
      }
      tagsLock = false;
    };
    el.querySelector('#um_refresh')?.addEventListener('click', refreshTags);
    // 打开弹窗自动拉取版本列表
    refreshTags();
    const renderBases = async () => {
      const box = el.querySelector('#um_list');
      if (!box) return;
      box.innerHTML = KERNEL_BASES.map(
        (b, i) => `<div id="umb_${i}" data-i="${i}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;margin-bottom:6px;background:${b[0] === selBase ? 'rgba(52,120,246,.18)' : 'rgba(0,0,0,.15)'};">
        <span style="flex:1;min-width:0;font-size:.68rem;color:#eee;word-break:break-all;">${escHtml(b[1])}</span>
        <span id="uml_${i}" style="font-size:.6rem;color:#888;min-width:86px;text-align:right;">测速中…</span>
        <button id="ump_${i}" style="padding:4px 10px;border-radius:6px;border:1px solid ${b[0] === selBase ? 'rgba(52,120,246,.9)' : 'rgba(52,120,246,.5)'};background:${b[0] === selBase ? 'rgba(52,120,246,.35)' : 'rgba(52,120,246,.15)'};color:#fff;font-size:.64rem;">${b[0] === selBase ? '✓ 已选' : '选择'}</button>
      </div>`,
      ).join('');
      KERNEL_BASES.forEach((b, i) => {
        el.querySelector('#ump_' + i)?.addEventListener('click', () => {
          selBase = b[0];
          renderBases();
        });
      });
      // 一次性并行测速（打开即测，不循环）：6 源后台并行、总时长≈最慢单源（≤10s），不被环境截断
      // 经 LAN 代理（F50 192.168.0.1 入站）测各源；代理不可用回退直连
      const r = await runShellWithRoot(`
CFGY=${F50MGR_DIR}/config/clash/config.yaml
IP=$(netstat -tlnp 2>/dev/null | awk '/:14180 / && /LISTEN/{print $4; exit}' | sed 's/:[0-9]*$//'); [ -n "$IP" ] || IP=192.168.0.1
PXY=""
for PT in $(grep -E '^(mixed-port|port|socks-port):' "$CFGY" 2>/dev/null | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d ' ' | tr '\n' ' '); do
  [ -n "$PT" ] || continue
  if curl -m 2 -s -o /dev/null -x "http://$IP:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="http://$IP:$PT"; break; fi
  if curl -m 2 -s -o /dev/null -x "socks5h://$IP:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="socks5h://$IP:$PT"; break; fi
done
i=0
for BASE in ${KERNEL_BASES.map((b) => b[0]).join(' ') }; do
  (
    if [ -n "$PXY" ]; then
      t=$(curl -m 6 -A "Mozilla/5.0" -x "$PXY" -o /dev/null -s -w '%{http_code} %{time_total}' "$BASE/" 2>/dev/null)
    else
      t=$(curl -m 4 -A "Mozilla/5.0" -o /dev/null -s -w '%{http_code} %{time_total}' "$BASE/" 2>/dev/null)
    fi
    CODE=$(echo "$t" | awk '{print $1}'); TT=$(echo "$t" | awk '{print $2}')
    if [ -n "$CODE" ] && [ "$CODE" != "000" ] && [ -n "$TT" ] && [ "$TT" != "0.000000" ]; then echo "$i|$TT"; else echo "$i|X"; fi
  ) &
  i=$((i+1))
done
wait
`);
      (r.content || '')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => /^\d+\|[\d.X]+$/.test(s))
        .forEach((s) => {
          const [idx, t] = s.split('|');
          const el2 = el.querySelector('#uml_' + idx);
          if (!el2) return;
          if (t === 'X') { el2.textContent = '不可达'; el2.style.color = '#ef4444'; }
          else { el2.textContent = Math.round(parseFloat(t) * 1000) + ' ms'; el2.style.color = '#22c55e'; }
        });
    };
    el.querySelector('#um_go')?.addEventListener('click', async () => {

      const v = String(verSel.value || 'latest').trim();
      await runShellWithRoot(`printf 'branch=%s\\nversion=%s\\nbase=%s\\n' '${String(v).replace(/["\\]/g, '')}' '${String(v).replace(/["\\]/g, '')}' '${String(selBase).replace(/["\\]/g, '')}' > ${F50MGR_DIR}/config/update.conf`);
      close();
      await runKernelUpdate(v, v, selBase, el);
    });
    // 本地包：隐藏文件选择器，上传到 update.pkg.gz 后自动走安装流程
    el.querySelector('#um_manual')?.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.gz,.tgz';
      inp.style.display = 'none';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        createToast('正在上传 ' + f.name + ' …');
        const url = await saveZip(f);
        if (!url) { createToast('上传失败', 'red'); return; }
        const mv = await runShellWithRoot(`mv -f "${APP_FILES}/${url}" ${F50MGR_DIR}/run/update.pkg.gz 2>/dev/null && echo MOVED || echo MOVE_FAIL`);
        if (!((mv.content || '').includes('MOVED'))) { createToast('移到 update.pkg.gz 失败', 'red'); return; }
        close();
        await runKernelUpdate('latest', 'latest', '', el);
      };
      document.body.appendChild(inp);
      inp.click();
    });
    el.querySelector('.ok')?.addEventListener('click', () => close());
    renderBases();
  };

  // 卸载：三次确认 → 停进程 → 删开机自启 → 删除全部数据
  const uninstallF50 = async () => {
    if (!(await checkIsInstalled())) {
      createToast('未检测到已安装的 f50mgr', 'red');
      return;
    }
    if (!(await askConfirm('f50mgr_rm1', '卸载 f50mgr？', '将停止并强杀全部 f50mgr 进程、移除开机自启，并删除 /data/adb/f50mgr 全部数据（配置、管理密钥、日志、mihomo/EasyTier 内核、Web 面板）及备份文件。'))) return;
    if (!(await askConfirm('f50mgr_rm2', '再次确认', '此操作不可恢复：管理密钥、订阅链接与所有配置都会永久丢失。'))) return;
    if (!(await askConfirm('f50mgr_rm3', '最后一次确认', '确定要彻底卸载并清空全部数据吗？'))) return;
    const res = await runShellWithRoot(`
pkill -f 'f50mgr-watch.sh' 2>/dev/null
pkill -f 'f50mgr daemon' 2>/dev/null
pkill -f 'f50mgr-sched.sh' 2>/dev/null
sleep 3
pkill -9 -f 'f50mgr daemon' 2>/dev/null
pkill -9 -f 'f50mgr-watch.sh' 2>/dev/null
pkill -9 -f 'f50mgr-sched.sh' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/mihomo' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/easytier' 2>/dev/null
pkill -9 -f '${F50MGR_DIR}/bin/easytier-cli' 2>/dev/null
sed -i "\\|^${BOOT_LINE}$|d" ${BOOT_FILE} 2>/dev/null
sed -i "\\|^${SCHED_LINE}$|d" ${BOOT_FILE} 2>/dev/null
rm -rf ${F50MGR_DIR}
rm -f ${APP_FILES}/uploads/f50mgr-backup-* 2>/dev/null
sleep 1
N=$(pgrep -f 'f50mgr daemon' | wc -l)
if [ "$N" = "0" ]; then echo UNINSTALL_DONE; else echo UNINSTALL_PROC_REMAIN; pgrep -af 'f50mgr daemon'; fi
`);
    const out = (res.content || '').trim();
    if (out.includes('UNINSTALL_DONE')) {
      createToast('已卸载，全部数据已删除');
      refreshRunning();
    } else if (out.includes('UNINSTALL_PROC_REMAIN')) {
      createToast('数据已删除，但仍有残留进程，请查看输出', 'red');
      showTextDialog('f50mgr_rm_out', '卸载输出', out.slice(0, 2000));
    } else {
      createToast('卸载过程异常，请查看输出', 'red');
      showTextDialog('f50mgr_rm_out', '卸载输出', out.slice(0, 2000));
    }
  };

  // 备份：打包 f50mgr 全部数据为单个 zip/tar.gz，写入设备 uploads 目录并下载到手机；还原走「导入组件」
  const backupAll = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    if (!(await askConfirm('f50mgr_bak1', '备份全部数据？', '将 f50mgr 全部数据（f50mgr 内核、mihomo/EasyTier、全部配置、订阅密钥、管理密钥、劫持脚本存档、日志、开机自启状态）打包为单个文件；还原时点「导入组件」选择该备份文件即可全量还原。'))) return;
    const res = await runShellWithRoot(`
TS=$(date +%Y%m%d-%H%M%S)
BK=${F50MGR_DIR}/backup/f50mgr-backup-$TS
rm -rf "$BK"
mkdir -p "$BK/bin" "$BK/config/clash" "$BK/config/easytier" "$BK/config/rules" "$BK/data/orig_scripts" "$BK/run"
cp -f ${F50MGR_DIR}/bin/f50mgr "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/bin/mihomo "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/bin/easytier "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/bin/easytier-cli "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/f50mgr.toml "$BK/config/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/secrets.toml "$BK/config/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/custom_rules.txt "$BK/config/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/schedule.json "$BK/config/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/subscriptions.json "$BK/config/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/rulesets.json "$BK/config/" 2>/dev/null
cp -rf ${F50MGR_DIR}/config/rules/. "$BK/config/rules/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/clash/config.yaml "$BK/config/clash/" 2>/dev/null
cp -rf ${F50MGR_DIR}/config/clash/dashboard/. "$BK/config/clash/" 2>/dev/null
cp -rf ${F50MGR_DIR}/config/easytier/. "$BK/config/easytier/" 2>/dev/null
cp -rf ${F50MGR_DIR}/data/orig_scripts/. "$BK/data/orig_scripts/" 2>/dev/null
cp -f ${F50MGR_DIR}/run/.auth_secret "$BK/run/" 2>/dev/null
cp -f ${F50MGR_DIR}/run/f50mgr.log "$BK/run/" 2>/dev/null
if grep -qF '${BOOT_LINE}' /sdcard/ufi_tools_boot.sh 2>/dev/null; then BOOT=ON; else BOOT=OFF; fi
cat > "$BK/BACKUP.info" <<EOF
TYPE=f50mgr-backup
DATE=$TS
BOOT=$BOOT
EOF
mkdir -p ${F50MGR_DIR}/backup/out
cd "$BK" || exit 1
if command -v zip >/dev/null 2>&1; then
  zip -q -r ${F50MGR_DIR}/backup/out/f50mgr-backup-$TS.zip .
  OUT=${F50MGR_DIR}/backup/out/f50mgr-backup-$TS.zip
else
  tar -czf ${F50MGR_DIR}/backup/out/f50mgr-backup-$TS.tar.gz .
  OUT=${F50MGR_DIR}/backup/out/f50mgr-backup-$TS.tar.gz
fi
cd /
rm -rf "$BK"
[ -f "$OUT" ] || { echo 'BAK_FAIL'; exit 1; }
SIZE=$(wc -c < "$OUT")
NAME=$(basename "$OUT")
mkdir -p ${APP_FILES}/uploads
cp -f "$OUT" ${APP_FILES}/uploads/"$NAME" 2>/dev/null
[ -f ${APP_FILES}/uploads/"$NAME" ] && echo "DL_NAME=$NAME" || echo 'DL_NAME='
echo "OUT=$OUT"
echo "SIZE=$SIZE"
echo "BAK_OK"
`);
    const out = (res.content || '').trim();
    if (!out.includes('BAK_OK')) {
      createToast('备份失败，请查看输出', 'red');
      showTextDialog('f50mgr_bak_res', '备份失败', out.slice(0, 2000));
      return;
    }
    const outPath = (out.match(/OUT=(.*)/) || [])[1] || '';
    const dlName = (out.match(/DL_NAME=(.*)/) || [])[1] || '';
    const size = (out.match(/SIZE=(\d+)/) || [])[1] || '';
    let saved = false;
    if (dlName) {
      try {
        // 平台自带下载通道：/api/uploads/<文件名>（应用文件管理里同样可见）
        const a = document.createElement('a');
        a.href = `${KANO_baseURL}/uploads/${dlName}`;
        a.download = dlName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        saved = true;
      } catch (e) {
        saved = false;
      }
    }
    const fname = dlName || (outPath.split('/').pop() || '');
    const mb = size ? (parseInt(size, 10) / 1024 / 1024).toFixed(2) + ' MB' : '?';
    createToast(saved ? '备份成功，文件已开始下载' : '备份成功，文件在设备 uploads 目录');
    showTextDialog(
      'f50mgr_bak_res',
      '备份完成',
      `备份文件：${fname}\n大小：${mb}\n设备端副本：${outPath}\n\n` +
        (saved
          ? '已开始下载到手机。还原：点「导入组件」选择这个备份文件，即可全量还原（配置/密钥/自启状态都会恢复）。'
          : `手机端下载失败。备份文件在设备 ${APP_FILES}/uploads/ 目录（应用「文件管理」里也能看到），把文件取到手机后，用「导入组件」选择它即可全量还原。`),
    );
  };

  const showLog = async () => {
    // 日志不依赖安装状态：无论是否已安装都能查看，并附带安装状态诊断
    const res = await runShellWithRoot(`
echo '===== 安装状态 ====='
ls -l ${F50MGR_BIN} ${F50MGR_TOML} ${F50MGR_WATCH} 2>/dev/null || echo '(核心文件缺失)'
echo '===== 进程 ====='
pgrep -af 'f50mgr|mihomo|easytier' 2>/dev/null || echo '(无相关进程)'
echo '===== 监听 ====='
netstat -tlnp 2>/dev/null | grep -E ':(14180|14191|14192|14193)' || echo '(无监听)'
echo '===== 日志 (tail 100) ====='
tail -n 100 ${F50MGR_LOG} 2>/dev/null || echo '(无日志文件)'
`);
    showTextDialog('f50mgr_log', 'f50mgr 日志与状态', res.content || '(无输出)');
  };

  // ============ OpenClash 移植：订阅管理（走 f50mgr 自带下载通道，与 MGR 网页控制台同源） ============
  // 读取 secrets.toml [subscription] url（容缩进 / 单双引号）
  const readSubUrl = async () => {
    const res = await runShellWithRoot(
      `grep -E '^[[:space:]]*url[[:space:]]*=' ${F50MGR_SECRETS} 2>/dev/null | head -1 | sed 's/^[[:space:]]*url[[:space:]]*=[[:space:]]*//' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"`,
    );
    return (((res.content || '').trim().split('\n').pop()) || '').trim();
  };

  // 写入 secrets.toml [subscription] url：段感知（保留 easytier 等其他段），值经临时文件传给 awk，避免转义问题
  const writeSubUrl = async (url) => {
    const esc = String(url || '').replace(/["$`\\]/g, '\\$&');
    const res = await runShellWithRoot(`
mkdir -p ${F50MGR_DIR}/config ${F50MGR_DIR}/run
F=${F50MGR_SECRETS}
if [ ! -f "$F" ]; then cat > "$F" <<'SEC_EOF'
[subscription]
url = ""
SEC_EOF
chmod 600 "$F"; fi
grep -q '^\\[subscription\\]' "$F" 2>/dev/null || printf '\\n[subscription]\\nurl = ""\\n' >> "$F"
printf '%s' "${esc}" > ${F50MGR_DIR}/run/.suburl.raw
awk -v f=${F50MGR_DIR}/run/.suburl.raw '
BEGIN{ ins=0; getline nurl < f; close(f) }
/^\\[/{ ins=($0=="[subscription]"); print; next }
ins && /^url[[:space:]]*=/{ print "url = \\"" nurl "\\""; next }
{ print }
' "$F" > "$F.tmp" && mv -f "$F.tmp" "$F" && chmod 600 "$F"
rm -f ${F50MGR_DIR}/run/.suburl.raw
echo SUB_WRITTEN
`);
    return (res.content || '').includes('SUB_WRITTEN');
  };

  // 订阅状态总览（含订阅库 / 规则集 / 定时任务状态）
  const showSubscribeStatus = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const res = await runShellWithRoot(`
echo '—— 订阅地址（token 已脱敏） ——'
grep -E '^url[[:space:]]*=' ${F50MGR_SECRETS} 2>/dev/null | head -1 | sed 's/^url[[:space:]]*=[[:space:]]*//' | sed 's/token=[^&" ]*/token=***/g'
echo '—— 配置文件 ——'
ls -l ${CFG_YAML} 2>/dev/null || echo '(尚未生成 config.yaml，请先「更新订阅」)'
echo '—— 规则概览 ——'
if [ -f ${CFG_YAML} ]; then
  echo "总规则数: $(awk '/^rules:/{ins=1;next} ins&&/^[a-zA-Z]/{ins=0} ins&&/^[[:space:]]*-/{n++} END{print n+0}' ${CFG_YAML} 2>/dev/null)"
  echo "DIRECT 规则数: $(awk '/^rules:/{ins=1;next} ins&&/^[a-zA-Z]/{ins=0} ins&&/,DIRECT$/{n++} END{print n+0}' ${CFG_YAML} 2>/dev/null)"
fi
echo '—— 自定义覆写 ——'
echo "custom_rules.txt: $(wc -l < ${CUSTOM_RULES} 2>/dev/null || echo 0) 行"
echo '—— 定时任务配置 ——'
cat ${SCHEDULE_FILE} 2>/dev/null || echo '(未配置)'
echo '—— 定时脚本状态 ——'
pgrep -f 'f50mgr-sched.sh' >/dev/null 2>&1 && echo '运行中' || echo '未运行'
`);
    let extra = '';
    const lib = await readSubLibrary();
    if (lib.list.length) {
      const active = lib.list.find((s) => s.id === lib.active) || null;
      extra += '\n—— 订阅库（共 ' + lib.list.length + ' 个）——\n' +
        lib.list.map((s) => (s.id === lib.active ? '✅ ' : '· ') + s.name).join('\n') +
        (active ? '\n当前生效：' + active.name : '\n（未选择生效订阅）');
    }
    const rs = await readRulesets();
    if (rs.list.length) {
      const ar = rs.list.find((r) => r.id === rs.active) || null;
      extra += '\n\n—— 规则集（共 ' + rs.list.length + ' 个）——\n' +
        rs.list.map((r) => (r.id === rs.active ? '✅ ' : '· ') + r.name).join('\n') +
        (ar ? '\n当前生效：' + ar.name : '');
    }
    showTextDialog('f50mgr_sub_st', '订阅与规则状态', (res.content || '(无输出)') + extra);
  };

  const clearSubscribe = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    if (!(await askConfirm('f50mgr_sub_clr', '清空订阅地址？', '仅清空 secrets.toml 中的订阅地址，不影响已生成的 config.yaml。'))) return;
    await writeSubUrl('');
    createToast('订阅地址已清空');
  };

  // 更新订阅：f50mgr subscription update（daemon ureq 下载，同网页控制台）→ 应用覆写 → 重载 mihomo
  const updateSubscribe = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    let url = await readSubUrl();
    if (!url) {
      const diag = await runShellWithRoot(`
F=${F50MGR_SECRETS}
if [ -f "$F" ]; then
  echo '--- secrets.toml 当前内容（token 已脱敏）---'
  sed 's/token=[^&" ]*/token=***/g' "$F"
  echo '--- 权限 ---'
  ls -l "$F"
else
  echo "(secrets.toml 不存在: ${F50MGR_SECRETS})"
fi
`);
      const input = await askInput(
        'f50mgr_sub_url',
        '更新订阅：先设置订阅地址',
        '未检测到订阅地址，请粘贴完整订阅链接（可带 ?token= 参数，与 MGR 网页控制台一致），或到「🖥 主控制面板」导入。' +
          '<br><br><span style="font-size:.6rem;color:#999;word-break:break-all;">' + escHtml((diag.content || '(无输出)').replace(/\n/g, '<br>')) + '</span>',
        'https://…/…?token=…',
        '',
      );
      if (!input) return;
      url = input;
      const saved = await writeSubUrl(url);
      if (!saved) {
        createToast('订阅地址写入失败', 'red');
        return;
      }
      await syncSubLibrary(url);
    }
    // 订阅处理管线：在线转换 / 节点筛选 已启用 → 走 run/f50mgr-sub-update.sh（下载→筛选→render）；否则走 daemon 原生通道
    const conf = await runShellWithRoot(`cat ${F50MGR_DIR}/config/subfilter.conf 2>/dev/null`);
    const usePipe = /^(converter|filter)=1/m.test(conf.content || '');
    let res;
    if (usePipe) {
      await deploySubFilterScript();
      createToast('正在更新订阅（转换/筛选管线）…');
      res = await runShellWithRoot(`sh ${F50MGR_DIR}/run/f50mgr-sub-update.sh 2>&1; echo "EXIT=$?"`);
    } else {
      createToast('正在更新订阅（走 f50mgr 自带下载通道，同 MGR 控制台）…');
      const U = String(url).replace(/["$`\\]/g, '\\$&');
      res = await runShellWithRoot(`
U="${U}"
${F50MGR_BIN} subscription update "$U" 2>&1
echo "EXIT=$?"
`);
    }
    const out = (res.content || '').trim();
    const exitCode = (out.match(/EXIT=(\d+)/) || [])[1];
    if (exitCode === '0') {
      await applyOverlay();
      await reloadMihomo();
      if (out.includes('SUB_OK_FALLBACK')) {
        createToast('订阅已更新（MGR 原生通道）· 转换/筛选本轮未生效');
        showTextDialog(
          'f50mgr_sub_res',
          '订阅更新成功（回退原生通道）',
          out.replace(/EXIT=\d+/, '').slice(0, 1500) +
            '\n\n转换/筛选管线下载失败（见上方 DL_SIZE / HTTP / DL_HEAD），已自动改用 MGR 控制台同款通道更新；转换/筛选本轮未生效。常见原因：转换服务地址不可用、机场拒绝当前 UA、或订阅地址 token 失效。可在「订阅处理设置」里检查转换服务地址，或稍后重试。',
        );
        return;
      }
      createToast('订阅更新成功，已应用覆写并重载配置');
      showTextDialog(
        'f50mgr_sub_res',
        '订阅更新成功',
        out.replace(/EXIT=\d+/, '').slice(0, 1500) +
          (usePipe ? '\n\n处理管线：在线转换 / 节点筛选 已应用（见 PROXIES_KEPT），并已重载 mihomo。' : '\n\n已自动应用：自定义规则（如存在），并按 MGR 控制台方式重载 mihomo。'),
      );
    } else {
      createToast('订阅更新失败（详见弹窗）', 'red');
      showTextDialog(
        'f50mgr_sub_res',
        '订阅更新失败（下载/解析返回）',
        (out.replace(/EXIT=\d+/, '') || '(无输出)').slice(0, 2000),
      );
    }
  };

  // 与 MGR 控制台同款重载：停 mihomo → daemon 看门狗自动用新 config.yaml 拉起
  const reloadMihomo = async () => {
    const res = await runShellWithRoot(`
pkill -f '${F50MGR_DIR}/bin/mihomo' 2>/dev/null
sleep 3
if ! pgrep -f '${F50MGR_DIR}/bin/mihomo' >/dev/null 2>&1; then
  if ! pgrep -f 'f50mgr daemon' >/dev/null 2>&1; then
    nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
    sleep 4
  fi
  sleep 2
fi
D=$(pgrep -f 'f50mgr daemon' | head -1)
M=$(pgrep -f '${F50MGR_DIR}/bin/mihomo' | head -1)
[ -n "$M" ] && echo "RELOAD_OK daemon=$D mihomo=$M" || echo "RELOAD_WARN daemon=$D"
`);
    const out = (res.content || '').trim();
    if (!out.includes('RELOAD_OK')) {
      createToast('配置已更新，但 mihomo 未自动拉起，请查看日志', 'red');
    }
    return out.includes('RELOAD_OK');
  };

  // ============ OpenClash 移植：多订阅选择（订阅库 + 切换生效） ============
  // 通用 JSON 读写（quoted heredoc 字面写入）
  const writeJsonFile = async (file, obj) => {
    const res = await runShellWithRoot(`mkdir -p ${F50MGR_DIR}/config
cat > ${file} <<'F50JSONEOF'
${JSON.stringify(obj, null, 2)}
F50JSONEOF
chmod 644 ${file}
echo JSON_SAVED`);
    return (res.content || '').includes('JSON_SAVED');
  };
  const readJsonFile = async (file, defaults) => {
    const res = await runShellWithRoot(`cat ${file} 2>/dev/null`);
    const raw = (res.content || '').trim();
    if (!raw) return defaults;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      return Object.assign({}, defaults, m ? JSON.parse(m[0]) : {});
    } catch (e) {
      return defaults;
    }
  };

  const escHtml = (v) =>
    String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const SUB_DEFAULTS = { list: [], active: '' };
  const readSubLibrary = async () => readJsonFile(SUB_LIB, Object.assign({}, SUB_DEFAULTS));
  const writeSubLibrary = async (lib) => writeJsonFile(SUB_LIB, lib);

  // 把当前单个订阅地址同步进订阅库（快速设置/清空时保持两者一致）
  const syncSubLibrary = async (url) => {
    const lib = await readSubLibrary();
    const u = String(url || '');
    if (!lib.list.length) {
      const id = 'sub_' + createRandomString(4);
      lib.list.push({ id, name: '订阅1', url: u });
      lib.active = id;
    } else {
      const cur = lib.list.find((s) => s.id === lib.active);
      if (cur) cur.url = u;
      else {
        lib.list[0].url = u;
        lib.active = lib.list[0].id;
      }
    }
    await writeSubLibrary(lib);
  };

  // 订阅管理器：新增 / 删除 / 切换生效（切换即同步 secrets.toml，与 MGR 控制台一致）
  const subscribeManager = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const lib = await readSubLibrary();
    const rid = 'f50mgr_sublist';
    const { el, close } = createFixedToast(
      'f50mgr_subs',
      `<div style="pointer-events:all;width:90vw;max-width:560px;">
      <div class="title" style="margin:0">订阅管理（多订阅选择）</div>
      <div style="margin-top:10px;font-size:.7rem;line-height:1.75">多个订阅可一键切换：「使用」即切换生效并同步到 secrets.toml（与 MGR 网页控制台一致），再点「📥 更新订阅」拉取。订阅地址 token 已脱敏显示。</div>
      <div id="${rid}" style="margin-top:12px;max-height:40vh;overflow-y:auto;"></div>
      <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
        <button class="add">➕ 新增订阅</button>
        <button class="sf">⚙ 处理设置</button>
        <button class="ok">关闭</button>
      </div>
    </div>`,
    );
    const listEl = el.querySelector('#' + rid);
    const renderList = () => {
      const active = lib.list.find((s) => s.id === lib.active) || null;
      listEl.innerHTML = lib.list.map((s) => {
        const isAct = s.id === lib.active;
        const masked = String(s.url || '').replace(/token=[^&" ]*/g, 'token=***');
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid ${isAct ? 'rgba(52,120,246,.6)' : 'rgba(255,255,255,.12)'};border-radius:8px;margin-bottom:8px;background:${isAct ? 'rgba(52,120,246,.12)' : 'rgba(0,0,0,.15)'};">
        <div style="flex:1;min-width:0;">
          <div style="font-size:.75rem;color:#fff;">${isAct ? '✅ ' : ''}${escHtml(s.name)}</div>
          <div style="font-size:.62rem;color:#999;word-break:break-all;">${escHtml(masked || '（无地址）')}</div>
        </div>
        <button class="use" data-id="${s.id}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(52,120,246,.5);background:${isAct ? 'rgba(52,120,246,.45)' : 'rgba(52,120,246,.2)'};color:#fff;font-size:.65rem;">${isAct ? '当前' : '使用'}</button>
        <button class="del" data-id="${s.id}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,.5);background:rgba(239,68,68,.15);color:#fff;font-size:.65rem;">删除</button>
      </div>`;
      }).join('') || '<div style="font-size:.7rem;color:#999;padding:8px;">暂无订阅，点「➕ 新增订阅」添加</div>';
      listEl.querySelectorAll('.use').forEach((b) => (b.onclick = async () => {
        const s = lib.list.find((x) => x.id === b.dataset.id);
        if (!s) return;
        if (s.id === lib.active) {
          const ok = await writeSubUrl(s.url);
          createToast(ok ? `「${s.name}」已是当前生效（已重新同步 secrets.toml）` : `「${s.name}」已是当前生效（同步 secrets.toml 失败）`, ok ? '' : 'red');
          return;
        }
        lib.active = s.id;
        await writeSubLibrary(lib);
        const ok = await writeSubUrl(s.url);
        createToast(ok ? `已切换生效：${s.name}（点「📥 更新订阅」拉取）` : '切换失败', ok ? '' : 'red');
        renderList();
      }));
      listEl.querySelectorAll('.del').forEach((b) => (b.onclick = async () => {
        const s = lib.list.find((x) => x.id === b.dataset.id);
        if (!s) return;
        if (!(await askConfirm('f50mgr_subs_del', '删除订阅？', '删除「' + s.name + '」。若为当前生效订阅，将自动改选第一个。'))) return;
        lib.list = lib.list.filter((x) => x.id !== s.id);
        if (lib.active === s.id) lib.active = lib.list.length ? lib.list[0].id : '';
        await writeSubLibrary(lib);
        if (lib.active) {
          const a = lib.list.find((x) => x.id === lib.active);
          if (a) await writeSubUrl(a.url);
        } else {
          await writeSubUrl('');
        }
        renderList();
      }));
    };
    el.querySelector('.add')?.addEventListener('click', async () => {
      const name = await askInput('f50mgr_sub_new1', '新增订阅', '给订阅起个名字（如：主力 / 备用）：', '主力订阅', '');
      if (name === null) return;
      const url = await askInput('f50mgr_sub_new2', '新增订阅', '粘贴完整订阅链接（可带 ?token= 参数，与 MGR 控制台一致）：', 'https://…/…?token=…', '');
      if (url === null) return;
      const id = 'sub_' + createRandomString(4);
      const first = !lib.active;
      lib.list.push({ id, name: name || '订阅', url });
      if (!lib.active) lib.active = id;
      await writeSubLibrary(lib);
      if (first && url) {
        const ok = await writeSubUrl(url);
        createToast(ok ? `已新增并设为当前生效（已同步 secrets.toml，点「📥 更新订阅」拉取）` : '已新增，但同步 secrets.toml 失败', ok ? '' : 'red');
      } else {
        createToast('已新增订阅（如需生效点「使用」）');
      }
      renderList();
    });
    el.querySelector('.sf')?.addEventListener('click', () => subFilterSettings());
    el.querySelector('.ok')?.addEventListener('click', () => close());
    renderList();
  };

  // ============ OpenClash 移植：规则集注入（config.yaml rules 段） ============
  // 部署覆写脚本：active.txt 原样注入 rules: 段之后（缩进跟随原 rules，纯 awk 结构校验）
  const deployOverlayScript = async () => {
    await runShellWithRoot(`
cat > ${OVERLAY_SCRIPT} <<'OVL_EOF'
#!/system/bin/sh
D=/data/adb/f50mgr
CFG=$D/config/clash/config.yaml
[ -f "$CFG" ] || { echo NO_CFG; exit 0; }
CR=$D/config/rules/active.txt
TMP=$D/run/config.yaml.ovl
CRF=0; [ -f "$CR" ] && CRF=1
# 注入顺序：规则集(active.txt) → 原规则；缩进跟随原 rules 列表（兼容顶格/2空格/4空格），避免 YAML 缩进不一致
awk -v cr="$CR" -v cf=$CRF '
function emitcr(src, IND,   line){
  while ((getline line < src) > 0) {
    gsub(/^[ \t]+|[ \t]+$/, "", line)
    if (line=="" || substr(line,1,1)=="#") continue
    print IND "- " line
  }
  close(src)
}
BEGIN{ ins=0; ind="" }
/^rules:[ \t]*\[\][ \t]*$/{
  print "rules:"
  ins=1
  if (cf==1) { ind="  "; emitcr(cr, ind) }
  next
}
/^rules:/{
  print
  ins=1
  next
}
ins==1 && /^[ \t]*-/{
  if (ind=="" && cf==1) { match($0, /^[ \t]*/); ind=substr($0,1,RLENGTH); emitcr(cr, ind) }
  if (ind=="") ind="  "
  print
  next
}
{ print }
' "$CFG" > "$TMP"
if [ -s "$TMP" ] && grep -q '^rules:' "$TMP"; then
  if ! awk '
    BEGIN{ rs=0; ind=""; bad=0 }
    /^rules:/{ rs=1; next }
    rs==1 && /^[ \t]*-/{
      match($0, /^[ \t]*/); i=substr($0,1,RLENGTH)
      if (ind=="") ind=i; else if (i!=ind) bad=1
    }
    END{ exit bad }
  ' "$TMP"; then
    rm -f "$TMP"
    echo OVERLAY_YAML_INVALID
    exit 0
  fi
  mv -f "$TMP" "$CFG"
  echo OVERLAY_OK
else
  rm -f "$TMP"
  echo OVERLAY_FAIL
fi
OVL_EOF
chmod 755 ${OVERLAY_SCRIPT}
echo DEPLOYED
`);
  };

  const applyOverlay = async () => {
    await deployOverlayScript();
    const res = await runShellWithRoot(`sh ${OVERLAY_SCRIPT}`);
    const out = (res.content || '').trim();
    if (out.includes('NO_CFG')) {
      createToast('尚未生成 config.yaml，请先「更新订阅」', 'red');
      return false;
    }
    if (out.includes('OVERLAY_OK')) return true;
    createToast('规则注入失败，请查看配置', 'red');
    return false;
  };

  // 通用保存函数：把多行文本写入指定文件（quoted heredoc，内容字面保存）；dir 为文件所在目录
  const saveTextFile = async (file, text, dir) => {
    const delim = 'F50FILE_EOF_' + createRandomString(6);
    const res = await runShellWithRoot(`mkdir -p ${dir || (F50MGR_DIR + '/config')}
cat > ${file} <<'${delim}'
${text}
${delim}
chmod 644 ${file}
echo FILE_SAVED`);
    return (res.content || '').includes('FILE_SAVED');
  };

  // 订阅处理管线（在线转换 / 节点筛选）：下载原始订阅 → 按保留/排除关键词过滤 → 交 daemon render
  // 设备端脚本 run/f50mgr-sub-update.sh + 配置 config/subfilter.conf（converter=1/filter=1）
  const deploySubFilterScript = async () => {
    await runShellWithRoot(`
mkdir -p ${F50MGR_DIR}/config ${F50MGR_DIR}/run
[ -f ${F50MGR_DIR}/config/subfilter.conf ] || printf 'converter=0\\nconverter_url=\\nconv_host=api.asailor.org\\nconv_tpl=带Urltest\\nconv_opts=emoji:0|udp:1|sort:0|tfo:0|tls13:0|skipcv:1|insert:0|ruleset:0\\nconv_custom=\\nfilter=0\\n' > ${F50MGR_DIR}/config/subfilter.conf
cat > ${F50MGR_DIR}/run/f50mgr-sub-update.sh <<'SFU_EOF'
#!/system/bin/sh
D=/data/adb/f50mgr
T=$D/run
CFG=$D/config/subfilter.conf
INC=$D/config/filter.inc.txt
EXC=$D/config/filter.exc.txt
SEC=$D/config/secrets.toml
BIN=$D/bin/f50mgr
YAML=$D/config/clash/config.yaml
UA="clash.meta"
URL=$(grep -E '^[[:space:]]*url[[:space:]]*=' "$SEC" 2>/dev/null | head -1 | sed 's/^[[:space:]]*url[[:space:]]*=[[:space:]]*//' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
[ -z "$URL" ] && { echo 'NO_URL'; exit 1; }
ORIG_URL="$URL"
CONV=$(grep -E '^converter=' "$CFG" 2>/dev/null | head -1 | sed 's/^converter=//')
CTMPL=$(grep -E '^converter_url=' "$CFG" 2>/dev/null | head -1 | sed 's/^converter_url=//')
HOST=$(grep -E '^conv_host=' "$CFG" 2>/dev/null | head -1 | sed 's/^conv_host=//')
TPL=$(grep -E '^conv_tpl=' "$CFG" 2>/dev/null | head -1 | sed 's/^conv_tpl=//')
OPTS=$(grep -E '^conv_opts=' "$CFG" 2>/dev/null | head -1 | sed 's/^conv_opts=//')
CUSTOM=$(grep -E '^conv_custom=' "$CFG" 2>/dev/null | head -1 | sed 's/^conv_custom=//')
FLT=$(grep -E '^filter=' "$CFG" 2>/dev/null | head -1 | sed 's/^filter=//')
enc(){ printf '%s' "$1" | od -An -tx1 | tr -d ' \\n' | sed 's/../%&/g'; }
if [ "$CONV" = "1" ]; then
  if [ -n "$CTMPL" ]; then
    URL=$(printf '%s' "$CTMPL" | sed "s|{url}|$(enc "$URL")|g")
  else
    [ -n "$HOST" ] || HOST=sub.xeton.dev
    BASE="https://$HOST/sub?target=clash&url=$(enc "$URL")"
    [ -n "$TPL" ] && BASE="$BASE&config=$(enc "$TPL")"
    for kv in $(echo "$OPTS" | tr '|' ' '); do
      case "$kv" in
        emoji:1) BASE="$BASE&emoji=true";;
        udp:1) BASE="$BASE&udp=true";;
        sort:1) BASE="$BASE&sort=true";;
        tfo:1) BASE="$BASE&tfo=true";;
        tls13:1) BASE="$BASE&tls13=true";;
        skipcv:1) BASE="$BASE&skip-cert-verify=true";;
        insert:1) BASE="$BASE&insert=true";;
        ruleset:1) BASE="$BASE&use_ruleset=true";;
      esac
    done
    if [ -n "$CUSTOM" ]; then
      CUSTOM=$(printf '%s' "$CUSTOM" | tr '\\n' '&')
      BASE="$BASE&$CUSTOM"
    fi
    URL="$BASE"
  fi
  echo "CONV_URL=$URL"
fi
dl(){ curl -sL --compressed -m 90 -A "$UA" -o "$T/sub.raw" -w 'HTTP=%{http_code} SIZE=%{size_download}' "$1" 2>/dev/null; echo; }
DLINFO=$(dl "$URL")
SZ=$(wc -c < "$T/sub.raw" 2>/dev/null)
if [ -z "$SZ" ] || [ "$SZ" -lt 200 ]; then
  echo "DL_SIZE=\${SZ:-0} (\${DLINFO})"
  head -c 160 "$T/sub.raw" 2>/dev/null | tr -d '\\r\\n' | head -c 120 > "$T/.subhead"
  [ -s "$T/.subhead" ] && echo "DL_HEAD=$(cat "$T/.subhead")"
  if [ "$URL" != "$ORIG_URL" ]; then
    echo 'CONV_FAIL_TRY_ORIG'
    DLINFO=$(dl "$ORIG_URL")
    SZ=$(wc -c < "$T/sub.raw" 2>/dev/null)
    echo "ORIG_SIZE=\${SZ:-0} (\${DLINFO})"
  fi
fi
if [ -z "$SZ" ] || [ "$SZ" -lt 200 ]; then
  echo 'DL_FAIL_FALLBACK_DAEMON'
  "$BIN" subscription update "$ORIG_URL" 2>&1 || { echo 'DAEMON_FAIL'; exit 1; }
  [ -x "$D/bin/f50mgr-apply-overlay.sh" ] && sh "$D/bin/f50mgr-apply-overlay.sh" 2>/dev/null
  pkill -f "$D/bin/mihomo" 2>/dev/null
  sleep 2
  echo 'SUB_OK_FALLBACK'
  exit 0
fi
if [ "$FLT" = "1" ]; then
  INCL=$(tr '\\n' ',' < "$INC" 2>/dev/null | sed 's/,$//')
  EXCL=$(tr '\\n' ',' < "$EXC" 2>/dev/null | sed 's/,$//')
  awk -v INCL="$INCL" -v EXCL="$EXCL" '
BEGIN{
  nin=0; n_inc=0
  n=split(INCL,gs,",")
  for(g=1;g<=n;g++){ if(gs[g]=="") continue; m=split(gs[g],ks,"&"); nin++; grp_s[nin]=n_inc+1; grp_e[nin]=n_inc+m+1; for(i=1;i<=m;i++){ n_inc++; inc[n_inc]=ks[i] } }
  nex=0; n_exc=0
  n=split(EXCL,gs2,",")
  for(g=1;g<=n;g++){ if(gs2[g]=="") continue; m=split(gs2[g],ks,"&"); nex++; xgrp_s[nex]=n_exc+1; xgrp_e[nex]=n_exc+m+1; for(i=1;i<=m;i++){ n_exc++; exc[n_exc]=ks[i] } }
}
function has(n,k){ return index(tolower(n),tolower(k))>0 }
function keepit(n,  g,i,ok){
  if(n_inc==0) return 1
  for(g=1;g<=nin;g++){ ok=1; for(i=grp_s[g];i<grp_e[g];i++) if(!has(n,inc[i])){ok=0;break} if(ok) return 1 }
  return 0
}
function dropit(n,  g,i,ok){
  for(g=1;g<=nex;g++){ ok=1; for(i=xgrp_s[g];i<xgrp_e[g];i++) if(!has(n,exc[i])){ok=0;break} if(ok) return 1 }
  return 0
}
function flush(){
  if(buf!=""){
    if(!dropit(cur)&&keepit(cur)) printf "%s", buf
    buf=""; cur=""
  }
}
/^proxies:/{ flush(); insec=1; print; next }
insec && /^[a-zA-Z][a-zA-Z0-9_-]*:/{ insec=0; flush() }
insec && /^[[:space:]]*-[[:space:]]*name[[:space:]]*:/{
  flush()
  line=$0; sub(/^[[:space:]]*-[[:space:]]*name[[:space:]]*:[[:space:]]*/,"",line); sub(/^"|"$/,"",line)
  cur=line; buf=$0 "\\n"; next
}
insec && buf!=""{ buf=buf $0 "\\n"; next }
{ print }
END{ flush() }
' "$T/sub.raw" > "$T/sub.f" 2>/dev/null || { echo 'FILTER_FAIL'; exit 1; }
  NPRX=$(grep -cE '^[[:space:]]*-[[:space:]]*name:' "$T/sub.f" 2>/dev/null || echo 0)
  echo "PROXIES_KEPT=$NPRX (INCL=$INCL EXCL=$EXCL)"
  [ "$NPRX" -lt 1 ] && { echo 'FILTER_DROPPED_ALL'; exit 1; }
else
  cp -f "$T/sub.raw" "$T/sub.f"
fi
if ! "$BIN" subscription render "$T/sub.f" 2>&1; then
  echo 'RENDER_NOT_AVAIL_COPY'
  cp -f "$T/sub.f" "$YAML"
fi
[ -x "$D/bin/f50mgr-apply-overlay.sh" ] && sh "$D/bin/f50mgr-apply-overlay.sh" 2>/dev/null
pkill -f "$D/bin/mihomo" 2>/dev/null
sleep 2
echo 'SUB_OK'
SFU_EOF
chmod 755 ${F50MGR_DIR}/run/f50mgr-sub-update.sh
echo SUB_FILTER_DEPLOYED`);
  };

  // 订阅处理设置弹窗：在线订阅转换（模板含 {url}）+ 节点筛选（保留/排除关键词）
  const subFilterSettings = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    await deploySubFilterScript();
    const cur = await runShellWithRoot(`
cat ${F50MGR_DIR}/config/subfilter.conf 2>/dev/null
echo '--INC--'
cat ${F50MGR_DIR}/config/filter.inc.txt 2>/dev/null
echo '--EXC--'
cat ${F50MGR_DIR}/config/filter.exc.txt 2>/dev/null
`);
    const c = (cur.content || '');
    const conv = /^converter=1/m.test(c);
    const cu = ((c.match(/^converter_url=(.*)$/m) || [])[1] || '').trim();
    const host = ((c.match(/^conv_host=(.*)$/m) || [])[1] || 'api.asailor.org').trim();
    const tpl = ((c.match(/^conv_tpl=(.*)$/m) || [])[1] || '带Urltest').trim();
    const optsRaw = ((c.match(/^conv_opts=(.*)$/m) || [])[1] || '').trim();
    const opt = (k) => new RegExp('(^|\\|)' + k + ':1(\\||$)').test(optsRaw);
    const custom = ((c.match(/^conv_custom=(.*)$/m) || [])[1] || '').trim();
    const flt = /^filter=1/m.test(c);
    const incTxt = (((c.split('--INC--')[1] || '').split('--EXC--')[0] || '').trim());
    const excTxt = (((c.split('--EXC--')[1] || '')).trim());
    const CONV_HOSTS = ['api.asailor.org', 'sub.xeton.dev', 'sub.dlj.me', 'sub.palfun.icu', 'sub.smallq.fun', 'custom'];
    const { el, close } = createFixedToast(
      'f50mgr_subflt',
      `<div style="pointer-events:all;width:94vw;max-width:600px;">
      <div class="title" style="margin:0">订阅处理设置</div>
      <div style="margin-top:8px;font-size:.68rem;line-height:1.7;color:#bbb;">启用后，「📥 更新订阅」与定时订阅更新走 下载→处理→渲染 管线。在线转换：用转换服务包裹原订阅链接（支持模板/选项/自定义参数）；节点筛选：按关键词保留/排除节点，每行一组，&amp; 表示同组全部命中（如：香港 / 台湾&amp;bgp / 新加坡&amp;bgp&amp;奈飞）。</div>
      <div style="margin-top:12px;font-size:.75rem;color:#eee;">🔄 在线订阅转换</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:.7rem;color:#eee;">
        <label><input type="checkbox" id="f50mgr_sf_conv" ${conv ? 'checked' : ''}> 启用</label>
        <span style="color:#999;">（在线转换存在隐私泄露风险，token 会经过第三方转换服务）</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.7rem;color:#eee;">
        <span style="min-width:88px;">转换服务地址:</span>
        <select id="f50mgr_sf_host" style="flex:1;min-width:0;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;">
          ${CONV_HOSTS.map((h) => `<option value="${h}" ${h === host ? 'selected' : ''}>${escHtml(h)}</option>`).join('')}
        </select>
        <input type="text" id="f50mgr_sf_host_c" value="${escHtml(host)}" placeholder="自定义地址（如 api.example.com）" style="flex:1;min-width:0;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;font-size:.68rem;display:${host === 'custom' ? '' : 'none'};">
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.7rem;color:#eee;">
        <span style="min-width:88px;">转换模板:</span>
        <input type="text" id="f50mgr_sf_tpl" value="${escHtml(tpl)}" placeholder="带Urltest / 基础 等（SubConverter 模板名）" style="flex:1;min-width:0;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;font-size:.68rem;">
      </div>
      <div style="margin-top:6px;font-size:.66rem;color:#eee;">选项：</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;font-size:.66rem;color:#eee;">
        <label><input type="checkbox" class="sf_opt" data-k="emoji" ${opt('emoji') ? 'checked' : ''}> 添加 Emoji</label>
        <label><input type="checkbox" class="sf_opt" data-k="skipcv" ${opt('skipcv') ? 'checked' : ''}> 跳过证书验证</label>
        <label><input type="checkbox" class="sf_opt" data-k="insert" ${opt('insert') ? 'checked' : ''}> 插入节点类型</label>
        <label><input type="checkbox" class="sf_opt" data-k="tfo" ${opt('tfo') ? 'checked' : ''}> TFO 加速</label>
        <label><input type="checkbox" class="sf_opt" data-k="udp" ${opt('udp') ? 'checked' : ''}> UDP 支持</label>
        <label><input type="checkbox" class="sf_opt" data-k="sort" ${opt('sort') ? 'checked' : ''}> 排序</label>
        <label><input type="checkbox" class="sf_opt" data-k="ruleset" ${opt('ruleset') ? 'checked' : ''}> 使用规则集</label>
        <label><input type="checkbox" class="sf_opt" data-k="tls13" ${opt('tls13') ? 'checked' : ''}> TLS 1.3</label>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px;font-size:.7rem;color:#eee;">
        <textarea id="f50mgr_sf_custom" placeholder="自定义参数（每行一个，直接追加到转换 URL）&#10;例如: rename=match@replace" style="flex:1;min-width:0;height:52px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;font-size:.66rem;resize:vertical;">${escHtml(custom)}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px;font-size:.68rem;color:#bbb;">高级：完整转换地址模板（含 {url}，留空则用上方 服务地址+模板+选项 构建）</div>
      <input type="text" id="f50mgr_sf_cu" value="${escHtml(cu)}" placeholder="https://sub.xeton.dev/sub?target=clash&url={url}" style="width:100%;margin-top:4px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;font-size:.66rem;box-sizing:border-box;">
      <div style="margin-top:12px;font-size:.75rem;color:#eee;">🎯 节点筛选</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:.7rem;color:#eee;">
        <label><input type="checkbox" id="f50mgr_sf_flt" ${flt ? 'checked' : ''}> 启用</label>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <textarea id="f50mgr_sf_inc" placeholder="保留节点（关键词，每行一组，留空=全部保留）&#10;例：香港 / 台湾&amp;bgp / 新加坡&amp;bgp&amp;奈飞" style="flex:1;min-width:0;height:88px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;font-size:.68rem;resize:vertical;">${escHtml(incTxt)}</textarea>
        <textarea id="f50mgr_sf_exc" placeholder="排除节点（关键词，每行一组，留空=不排除）&#10;例：IEPL / 机场名&amp;测试" style="flex:1;min-width:0;height:88px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;font-size:.68rem;resize:vertical;">${escHtml(excTxt)}</textarea>
      </div>
      <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
        <button id="f50mgr_sf_prev" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;font-size:.68rem;">预览转换地址</button>
        <button class="ok">保存</button>
        <button class="cancel">取消</button>
      </div>
    </div>`,
    );
    const q = (s) => el.querySelector('#' + s);
    // 转换服务地址下拉联动自定义输入
    const syncHost = () => {
      q('f50mgr_sf_host_c').style.display = q('f50mgr_sf_host').value === 'custom' ? '' : 'none';
    };
    q('f50mgr_sf_host')?.addEventListener('change', syncHost);
    syncHost();
    // 构建转换 URL（与设备端脚本一致）
    const buildConvUrl = (rawUrl) => {
      const cuVal = String(q('f50mgr_sf_cu').value || '').replace(/["\\\r\n]/g, '');
      if (cuVal) return cuVal.replace(/\{url\}/g, encodeURIComponent(rawUrl));
      let host = q('f50mgr_sf_host').value;
      if (host === 'custom') host = String(q('f50mgr_sf_host_c').value || '').trim();
      if (!host) host = 'api.asailor.org';
      let u = `https://${host}/sub?target=clash&url=${encodeURIComponent(rawUrl)}`;
      const tpl = String(q('f50mgr_sf_tpl').value || '').trim();
      if (tpl) u += '&config=' + encodeURIComponent(tpl);
      el.querySelectorAll('.sf_opt').forEach((cb) => {
        if (!cb.checked) return;
        const map = { emoji: 'emoji=true', udp: 'udp=true', sort: 'sort=true', tfo: 'tfo=true', tls13: 'tls13=true', skipcv: 'skip-cert-verify=true', insert: 'insert=true', ruleset: 'use_ruleset=true' };
        if (map[cb.dataset.k]) u += '&' + map[cb.dataset.k];
      });
      const custom = String(q('f50mgr_sf_custom').value || '').trim();
      if (custom) u += '&' + custom.replace(/\n/g, '&');
      return u;
    };
    el.querySelector('#f50mgr_sf_prev')?.addEventListener('click', async () => {
      const rawUrl = await readSubUrl();
      if (!rawUrl) {
        createToast('先设置订阅地址（订阅管理 → 当前 同步，或更新订阅时填 URL）', 'red');
        return;
      }
      const u = buildConvUrl(rawUrl);
      showTextDialog('f50mgr_sf_prev_res', '转换地址预览（token 已脱敏）', u.replace(/(token=)[^&]*/, '$1***'));
    });
    const done = async () => {
      const convOn = !!(q('f50mgr_sf_conv') && q('f50mgr_sf_conv').checked);
      const cuVal = String(q('f50mgr_sf_cu').value || '').replace(/["\\\r\n]/g, '');
      let host = q('f50mgr_sf_host').value;
      if (host === 'custom') host = String(q('f50mgr_sf_host_c').value || '').trim();
      const tpl = String(q('f50mgr_sf_tpl').value || '').trim();
      const optParts = ['emoji', 'udp', 'sort', 'tfo', 'tls13', 'skipcv', 'insert', 'ruleset'].map((k) => {
        const cb = el.querySelector('.sf_opt[data-k="' + k + '"]');
        return k + ':' + (cb && cb.checked ? 1 : 0);
      });
      const custom = String(q('f50mgr_sf_custom').value || '').replace(/["\\\r\n]/g, '');
      const fltOn = !!(q('f50mgr_sf_flt') && q('f50mgr_sf_flt').checked);
      const incVal = (q('f50mgr_sf_inc').value || '').trim();
      const excVal = (q('f50mgr_sf_exc').value || '').trim();
      if (convOn && !cuVal && !host) {
        createToast('启用在线转换需填写转换服务地址或完整模板', 'red');
        return;
      }
      await runShellWithRoot(`
printf 'converter=%s\\nconverter_url=%s\\nconv_host=%s\\nconv_tpl=%s\\nconv_opts=%s\\nconv_custom=%s\\nfilter=%s\\n' '${convOn ? 1 : 0}' '${cuVal}' '${String(host).replace(/["\\]/g, '')}' '${String(tpl).replace(/["\\]/g, '')}' '${optParts.join('|')}' '${String(custom).replace(/["\\]/g, '')}' '${fltOn ? 1 : 0}' > ${F50MGR_DIR}/config/subfilter.conf
chmod 644 ${F50MGR_DIR}/config/subfilter.conf
echo CONF_SAVED`);
      await saveTextFile(F50MGR_DIR + '/config/filter.inc.txt', incVal, F50MGR_DIR + '/config');
      await saveTextFile(F50MGR_DIR + '/config/filter.exc.txt', excVal, F50MGR_DIR + '/config');
      createToast('订阅处理设置已保存');
      close();
    };
    el.querySelector('.ok')?.addEventListener('click', done);
    el.querySelector('.cancel')?.addEventListener('click', () => close());
  };






  const readRulesets = async () => readJsonFile(RULESETS, Object.assign({}, RULE_DEFAULTS));
  const writeRulesets = async (rs) => writeJsonFile(RULESETS, rs);

  const rulesetContent = async (id) => {
    const res = await runShellWithRoot(`cat ${RULES_DIR}/${id}.txt 2>/dev/null`);
    return (res.content || '').trim();
  };

  const rulesetCount = async (id) => {
    const res = await runShellWithRoot(`grep -v '^[[:space:]]*#' ${RULES_DIR}/${id}.txt 2>/dev/null | grep -c '[^[:space:]]'`);
    const n = parseInt((res.content || '').trim().split('\n').pop(), 10);
    return Number.isNaN(n) ? 0 : n;
  };

  // 把所选规则集内容同步为 active.txt（覆写脚本只注入 active.txt）
  const syncActiveRules = async (id) => {
    const text = await rulesetContent(id);
    return saveTextFile(RULES_ACTIVE, text, RULES_DIR);
  };

  // 规则集管理器：新建 / 编辑 / 删除 / 切换生效
  const ruleManager = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    let rs = await readRulesets();
    // 迁移：无规则库但有旧 custom_rules.txt → 导入为默认规则集
    if (!rs.list.length) {
      const old = await runShellWithRoot(`cat ${CUSTOM_RULES} 2>/dev/null`);
      const oldText = (old.content || '').trim();
      if (oldText) {
        const id = 'rule_' + createRandomString(4);
        rs.list.push({ id, name: '默认规则' });
        rs.active = id;
        await saveTextFile(`${RULES_DIR}/${id}.txt`, oldText, RULES_DIR);
        await syncActiveRules(id);
        await writeRulesets(rs);
      }
    }
    const rid = 'f50mgr_rulelist';
    const { el, close } = createFixedToast(
      'f50mgr_rules',
      `<div style="pointer-events:all;width:90vw;max-width:560px;">
      <div class="title" style="margin:0">规则集（多规则选择）</div>
      <div style="margin-top:10px;font-size:.7rem;line-height:1.75">多个规则集可一键切换：「使用」后立即重注入并重载 mihomo（规则注入在 config.yaml 的 rules 段最前）。</div>
      <div id="${rid}" style="margin-top:12px;max-height:40vh;overflow-y:auto;"></div>
      <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
        <button class="add">➕ 新建规则集</button>
        <button class="ok">关闭</button>
      </div>
    </div>`,
    );
    const listEl = el.querySelector('#' + rid);
    const renderList = async () => {
      const active = rs.list.find((r) => r.id === rs.active) || null;
      const rows = [];
      for (const r of rs.list) {
        const isAct = r.id === rs.active;
        const cnt = await rulesetCount(r.id);
        rows.push(`<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid ${isAct ? 'rgba(52,120,246,.6)' : 'rgba(255,255,255,.12)'};border-radius:8px;margin-bottom:8px;background:${isAct ? 'rgba(52,120,246,.12)' : 'rgba(0,0,0,.15)'};">
        <div style="flex:1;min-width:0;">
          <div style="font-size:.75rem;color:#fff;">${isAct ? '✅ ' : ''}${escHtml(r.name)}</div>
          <div style="font-size:.62rem;color:#999;">${cnt} 条规则</div>
        </div>
        <button class="use" data-id="${r.id}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(52,120,246,.5);background:${isAct ? 'rgba(52,120,246,.45)' : 'rgba(52,120,246,.2)'};color:#fff;font-size:.65rem;">${isAct ? '当前' : '使用'}</button>
        <button class="edit" data-id="${r.id}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font-size:.65rem;">编辑</button>
        <button class="del" data-id="${r.id}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,.5);background:rgba(239,68,68,.15);color:#fff;font-size:.65rem;">删除</button>
      </div>`);
      }
      listEl.innerHTML = rows.join('') || '<div style="font-size:.7rem;color:#999;padding:8px;">暂无规则集，点「➕ 新建规则集」创建</div>';
      listEl.querySelectorAll('.use').forEach((b) => (b.onclick = async () => {
        if (b.dataset.id === rs.active) {
          createToast('该规则集已是当前生效（可点「🛠 自定义规则」编辑）');
          return;
        }
        rs.active = b.dataset.id;
        await writeRulesets(rs);
        const ok = await syncActiveRules(b.dataset.id);
        createToast(ok ? '已切换规则集，正在应用…' : '切换失败', ok ? '' : 'red');
        await applyOverlay();
        await reloadMihomo();
        renderList();
      }));
      listEl.querySelectorAll('.edit').forEach((b) => (b.onclick = async () => {
        const r = rs.list.find((x) => x.id === b.dataset.id);
        if (!r) return;
        const text = await askTextarea('f50mgr_rule_edit', '编辑规则集：' + r.name, '每行一条 Clash 规则（# 开头为注释）：', await rulesetContent(r.id));
        if (text === null) return;
        await saveTextFile(`${RULES_DIR}/${r.id}.txt`, text, RULES_DIR);
        if (r.id === rs.active) {
          await saveTextFile(RULES_ACTIVE, text, RULES_DIR);
          await applyOverlay();
          await reloadMihomo();
        }
        renderList();
      }));
      listEl.querySelectorAll('.del').forEach((b) => (b.onclick = async () => {
        const r = rs.list.find((x) => x.id === b.dataset.id);
        if (!r) return;
        if (!(await askConfirm('f50mgr_rule_del', '删除规则集？', '删除「' + r.name + '」。若为当前生效，将自动改选第一个。'))) return;
        await runShellWithRoot(`rm -f ${RULES_DIR}/${r.id}.txt`);
        rs.list = rs.list.filter((x) => x.id !== r.id);
        if (rs.active === r.id) rs.active = rs.list.length ? rs.list[0].id : '';
        await writeRulesets(rs);
        if (rs.active) {
          await syncActiveRules(rs.active);
          await applyOverlay();
          await reloadMihomo();
        }
        renderList();
      }));
    };
    el.querySelector('.add')?.addEventListener('click', async () => {
      const name = await askInput('f50mgr_rule_new1', '新建规则集', '给规则集起个名字（如：全局代理 / 自定义）：', '自定义规则', '');
      if (name === null) return;
      const text = await askTextarea(
        'f50mgr_rule_new2',
        '新建规则集：' + (name || '自定义'),
        '每行一条 Clash 规则（# 开头为注释）。常用模板：<br>GEOIP,CN,DIRECT<br>MATCH,🚀 节点选择',
        'GEOIP,CN,DIRECT\nMATCH,🚀 节点选择',
      );
      if (text === null) return;
      const id = 'rule_' + createRandomString(4);
      rs.list.push({ id, name: name || '自定义' });
      if (!rs.list.length) rs.active = id;
      await saveTextFile(`${RULES_DIR}/${id}.txt`, text, RULES_DIR);
      if (!rs.active) {
        rs.active = id;
        await syncActiveRules(id);
      }
      await writeRulesets(rs);
      renderList();
    });
    el.querySelector('.ok')?.addEventListener('click', () => close());
    renderList();
  };

  // 自定义规则：直接编辑当前生效的 active.txt
  const editCustomRules = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const cur = await runShellWithRoot(`cat ${RULES_ACTIVE} 2>/dev/null`);
    const def = (cur.content || '').trim();
    const text = await askTextarea('f50mgr_custom_rules', '自定义规则（当前生效）', '每行一条 Clash 规则（# 开头为注释）：', def);
    if (text === null || text === undefined) return;
    await saveTextFile(RULES_ACTIVE, text, RULES_DIR);
    await applyOverlay();
    await reloadMihomo();
    createToast('自定义规则已保存并重载');
  };

  const showConfig = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const res = await runShellWithRoot(`sed -n '1,400p' ${CFG_YAML} 2>/dev/null || echo '(尚未生成 config.yaml，请先「更新订阅」)'`);
    showTextDialog('f50mgr_cfg', 'mihomo 配置文件（config.yaml，前 400 行）', res.content || '(无输出)');
  };

  // 运行设置：运行模式（增强/TUN/混合）+ 代理模式（规则/全局/直连），直接改写 config.yaml 顶部字段
  const modeSettings = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const cur = await runShellWithRoot(`
MODE=$(grep -E '^mode[[:space:]]*:' ${CFG_YAML} 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' )
TUN=$(sed -n '/^tun[[:space:]]*:/,/^[a-zA-Z]/{/^[[:space:]]*enable:/p}' ${CFG_YAML} 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' )
[ -n "$MODE" ] || MODE=rule
[ -n "$TUN" ] || TUN=false
echo "MODE=$MODE"
echo "TUN=$TUN"
`);
    const mode = (((cur.content || '').match(/MODE=(\w+)/) || [])[1]) || 'rule';
    const tun = (((cur.content || '').match(/TUN=(\w+)/) || [])[1]) || 'false';
    const { el, close } = createFixedToast(
      'f50mgr_mode',
      `<div style="pointer-events:all;width:90vw;max-width:480px;">
      <div class="title" style="margin:0">⚙️ 运行设置</div>
      <div style="margin-top:10px;font-size:.7rem;line-height:1.75">直接写入 mihomo 配置并重载。说明：增强=仅 iptables 透明代理（TUN 关）；TUN=mihomo TUN 接管；混合=TUN+增强双通道。代理模式：规则/全局/直连。</div>
      <div style="margin-top:12px;font-size:.75rem;color:#eee;">运行模式</div>
      <div style="display:flex;gap:14px;margin-top:6px;font-size:.75rem;color:#eee;">
        <label><input type="radio" name="f50mgr_runmode" value="enh" ${tun === 'false' ? 'checked' : ''}> 增强</label>
        <label><input type="radio" name="f50mgr_runmode" value="tun" ${tun === 'true' ? 'checked' : ''}> TUN</label>
        <label><input type="radio" name="f50mgr_runmode" value="mixed" ${tun === 'true' ? 'checked' : ''}> 混合</label>
      </div>
      <div style="margin-top:14px;font-size:.75rem;color:#eee;">代理模式</div>
      <div style="display:flex;gap:14px;margin-top:6px;font-size:.75rem;color:#eee;">
        <label><input type="radio" name="f50mgr_proxymode" value="rule" ${mode === 'rule' ? 'checked' : ''}> 规则</label>
        <label><input type="radio" name="f50mgr_proxymode" value="global" ${mode === 'global' ? 'checked' : ''}> 全局</label>
        <label><input type="radio" name="f50mgr_proxymode" value="direct" ${mode === 'direct' ? 'checked' : ''}> 直连</label>
      </div>
      <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
        <button class="ok">应用</button>
        <button class="cancel">取消</button>
      </div>
    </div>`,
    );
    const done = async () => {
      const rm = el.querySelector('input[name="f50mgr_runmode"]:checked')?.value || 'enh';
      const pm = el.querySelector('input[name="f50mgr_proxymode"]:checked')?.value || 'rule';
      const TUN = rm === 'enh' ? 'false' : 'true';
      const res = await runShellWithRoot(`
F=${CFG_YAML}
[ -f "$F" ] || { echo 'NO_CFG'; exit 1; }
awk -v newmode="${pm}" -v tunval="${TUN}" '
/^mode[[:space:]]*:/ { print "mode: " newmode; next }
/^tun[[:space:]]*:/ { tsect=1; tused=1; print; next }
tsect && /^[[:space:]]*enable:/ { sub(/^[[:space:]]*enable:.*/, "  enable: " tunval); print; next }
tsect && /^[a-zA-Z]/ { tsect=0 }
{ print }
END { if (!tused) { print "tun:"; print "  enable: " tunval; print "  stack: mixed"; print "  auto-route: false" } }
' "$F" > "$F.tmp" && mv -f "$F.tmp" "$F" && echo PATCH_OK
`);
      if (!(res.content || '').includes('PATCH_OK')) {
        createToast('写入失败，请查看输出', 'red');
        showTextDialog('f50mgr_mode_out', '写入输出', (res.content || '').slice(0, 1200));
        return;
      }
      await applyOverlay();
      await reloadMihomo();
      createToast(`已应用：运行模式 ${rm} / 代理模式 ${pm}，已重载 mihomo`);
      close();
    };
    el.querySelector('.ok')?.addEventListener('click', done);
    el.querySelector('.cancel')?.addEventListener('click', () => close());
  };

  // 代理选择：读 config.yaml 的 external-controller/secret，走 mihomo API 列出分组与节点并切换
  const proxySelector = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const info = await runShellWithRoot(`
EC=$(grep -E '^external-controller[[:space:]]*:' ${CFG_YAML} 2>/dev/null | head -1 | sed 's/^external-controller[[:space:]]*:[[:space:]]*//' | tr -cd 'A-Za-z0-9.:_-')
SEC=$(grep -E '^secret[[:space:]]*:' ${CFG_YAML} 2>/dev/null | head -1 | sed 's/^secret[[:space:]]*:[[:space:]]*//' | tr -cd 'A-Za-z0-9._-')
HOST=$(echo "$EC" | sed 's/:[0-9][0-9]*$//')
PORT=$(echo "$EC" | sed 's/.*://')
[ -z "$PORT" ] && PORT=14193
echo "HOST=$HOST"
echo "PORT=$PORT"
echo "SEC=$SEC"
command -v curl >/dev/null 2>&1 && echo "CURL=yes" || echo "CURL=no"
`);
    const host = (((info.content || '').match(/HOST=(.*)/) || [])[1] || '').trim();
    const port = (((info.content || '').match(/PORT=(\d+)/) || [])[1]) || '14193';
    const sec = (((info.content || '').match(/SEC=(.*)/) || [])[1] || '').trim();
    const hasCurl = /CURL=yes/.test(info.content || '');
    const mgrIp = await detectMgrIp();
    const cands = [];
    if (host && host !== '0.0.0.0' && host !== '*' && host !== '127.0.0.1') cands.push(`http://${host}:${port}`);
    cands.push(`http://127.0.0.1:${port}`);
    if (mgrIp && !cands.some((c) => c.indexOf(mgrIp) >= 0)) cands.push(`http://${mgrIp}:${port}`);
    const HDR = sec ? `-H "Authorization: Bearer ${sec}"` : '';
    const CL = cands.join(' ');
    const res = await runShellWithRoot(`for U in ${CL}; do
  OUT=$(curl -s -m 4 ${HDR} "$U/proxies" 2>/dev/null)
  [ -n "$OUT" ] && { echo "BASE=$U"; printf '%s' "$OUT"; exit 0; }
done
if [ -z "$OUT" ] && command -v wget >/dev/null 2>&1 && [ -z "${sec}" ]; then
  for U in ${CL}; do
    OUT=$(wget -qO- -T 4 "$U/proxies" 2>/dev/null)
    [ -n "$OUT" ] && { echo "BASE=$U"; printf '%s' "$OUT"; exit 0; }
  done
fi
echo "BASE="
`);
    const m = (res.content || '').match(/BASE=([^\n]*)/);
    const apiBase = (m && m[1]) || '';
    let data = null;
    try {
      data = JSON.parse((res.content || '').replace(/BASE=[^\n]*\n?/, ''));
    } catch (e) {
      data = null;
    }
    if (!data || !data.proxies) {
      createToast(
        '无法读取 mihomo 代理列表（API 不可达）；已尝试: ' + cands.join(' ') +
        (hasCurl ? '；curl 可用' : '；设备无 curl') + (apiBase ? '；命中: ' + apiBase : ''),
        'red',
      );
      return;
    }
    const groups = Object.entries(data.proxies).filter(([, v]) =>
      ['Select', 'URLTest', 'Fallback', 'LoadBalance'].includes(v.type),
    );
    if (!groups.length) {
      createToast('未找到可选分组', 'red');
      return;
    }
    const rid = 'f50mgr_plist';
    const { el, close } = createFixedToast(
      'f50mgr_psel',
      `<div style="pointer-events:all;width:90vw;max-width:560px;">
      <div class="title" style="margin:0">🧭 代理选择</div>
      <div style="margin-top:10px;font-size:.7rem;line-height:1.75">点击分组查看节点，再点击节点即切换（写入 mihomo 分组当前选择）。</div>
      <div id="${rid}" style="margin-top:12px;max-height:44vh;overflow-y:auto;"></div>
      <div style="margin-top:14px;text-align:right;"><button class="ok" style="padding:6px 16px;border-radius:6px;background:rgba(52,120,246,.9);color:#fff;font-size:.7rem;">关闭</button></div>
    </div>`,
    );
    const listEl = el.querySelector('#' + rid);
    const enc = (s) => Array.from(new TextEncoder().encode(s)).map((b) => '%' + b.toString(16).toUpperCase()).join('');
    const render = async (target, grpName) => {
      if (target === 'groups') {
        listEl.innerHTML = groups.map(([name, g]) => {
          const sel = typeof g.now === 'string' ? g.now : '';
          const cnt = (g.all ? g.all.length : 0) || (g.options ? g.options.length : 0) || 0;
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;margin-bottom:8px;background:rgba(0,0,0,.15);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:.75rem;color:#fff;">${escHtml(name)}</div>
            <div style="font-size:.62rem;color:#999;">${escHtml(String(sel || '未选择'))} · ${cnt} 个节点</div>
          </div>
          <button class="open" data-g="${escHtml(name)}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(52,120,246,.5);background:rgba(52,120,246,.2);color:#fff;font-size:.65rem;">选择</button>
        </div>`;
        }).join('') || '<div style="font-size:.7rem;color:#999;padding:8px;">无分组</div>';
        listEl.querySelectorAll('.open').forEach((b) => (b.onclick = () => render('nodes', b.dataset.g)));
      } else {
        const g = groups.find(([n]) => n === grpName);
        const nodes = (g && g[1] && (g[1].options || g[1].all)) || [];
        listEl.innerHTML =
          `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <button class="back" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font-size:.65rem;">← 返回分组</button>
            <span style="font-size:.75rem;color:#fff;">${escHtml(grpName)}</span>
            <span style="font-size:.6rem;color:#999;margin-left:auto;">自动测延迟</span>
          </div>` +
          nodes.map((n, i) => `<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;margin-bottom:8px;background:rgba(0,0,0,.15);">
          <div style="flex:1;min-width:0;font-size:.75rem;color:#fff;">${escHtml(n)}</div>
          <span id="ndel_${i}" class="ndel" style="font-size:.62rem;color:#888;min-width:52px;text-align:right;">--</span>
          <button class="ntest" data-n="${escHtml(n)}" style="padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;font-size:.6rem;">测速</button>
          <button class="pick" data-n="${escHtml(n)}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(52,120,246,.5);background:rgba(52,120,246,.2);color:#fff;font-size:.65rem;">切换</button>
        </div>`).join('') || '<div style="font-size:.7rem;color:#999;padding:8px;">该分组无直接节点</div>';
        listEl.querySelector('.back')?.addEventListener('click', () => render('groups'));
        listEl.querySelectorAll('.pick').forEach((b) => (b.onclick = async () => {
          const nd = String(b.dataset.n).replace(/["\\]/g, '');
          let r = null;
          if (hasCurl) {
            r = await runShellWithRoot(`curl -s -m 4 -X PUT ${apiBase}/proxies/${enc(grpName)} ${HDR} -d '{"name":"${nd}"}' 2>/dev/null; echo "RC=$?"`);
          } else if (!sec) {
            r = await runShellWithRoot(`wget -qO- -T 4 --method=PUT --body-data='{"name":"${nd}"}' ${apiBase}/proxies/${enc(grpName)} 2>/dev/null; echo "RC=$?"`);
          }
          createToast(
            r && r.content.includes('RC=0') ? `已切换：${grpName} → ${nd}` : (hasCurl ? '切换失败（检查 API/密钥）' : '设备无 curl 且需密钥，无法切换'),
            r && r.content.includes('RC=0') ? '' : 'red',
          );
        }));
        // 批量测延迟：GET /proxies/{node}/delay（mihomo 内置延迟测试），并行测速避免超时
        if (hasCurl && nodes.length) {
          const ql = nodes.map((n, i) => `${i}|${enc(n)}`).join('\n');
          const dr = await runShellWithRoot(`
mkdir -p ${F50MGR_DIR}/run/.nd
rm -f ${F50MGR_DIR}/run/.nd/*
cat > ${F50MGR_DIR}/run/.nodeq.txt <<'NQEOF'
${ql}
NQEOF
while IFS='|' read -r IDX EN; do
  [ -z "$IDX" ] && continue
  ( D=$(curl -s -m 8 ${HDR} "${apiBase}/proxies/$EN/delay?url=http://www.gstatic.com/generate_204&timeout=5000" 2>/dev/null | sed -n 's/.*"delay":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -1)
    echo "$IDX|\${D:--}" > ${F50MGR_DIR}/run/.nd/$IDX ) &
done < ${F50MGR_DIR}/run/.nodeq.txt
wait
cat ${F50MGR_DIR}/run/.nd/* 2>/dev/null
rm -rf ${F50MGR_DIR}/run/.nd ${F50MGR_DIR}/run/.nodeq.txt
`);
          (dr.content || '').split('\n').forEach((line) => {
            const [i, ms] = line.split('|');
            if (i == null || ms == null) return;
            const el = document.getElementById('ndel_' + i);
            if (!el) return;
            if (ms === '-') {
              el.textContent = '--';
              el.style.color = '#888';
            } else {
              const v = parseInt(ms, 10);
              el.textContent = v + ' ms';
              el.style.color = v < 300 ? '#22c55e' : v < 800 ? '#f5a623' : '#ef4444';
            }
          });
        }
        // 单节点测速：点「测速」只测当前节点
        listEl.querySelectorAll('.ntest').forEach((b) => (b.onclick = async () => {
          const nd = String(b.dataset.n).replace(/["\\|\r\n]/g, '');
          const sp = b.parentElement.querySelector('.ndel');
          if (sp) { sp.textContent = '测速中…'; sp.style.color = '#888'; }
          const tr = await runShellWithRoot(`curl -s -m 6 ${HDR} "${apiBase}/proxies/${enc(nd)}/delay?url=http://www.gstatic.com/generate_204&timeout=5000" 2>/dev/null`);
          const ms = (((tr.content || '').match(/"delay":[[:space:]]*([0-9]+)/) || [])[1] || '');
          if (sp) {
            if (ms) {
              const v = parseInt(ms, 10);
              sp.textContent = v + ' ms';
              sp.style.color = v < 300 ? '#22c55e' : v < 800 ? '#f5a623' : '#ef4444';
            } else { sp.textContent = '--'; sp.style.color = '#888'; }
          }
        }));
      }
    };
    el.querySelector('.ok')?.addEventListener('click', () => close());
    render('groups');
  };

  // ============ OpenClash 移植：定时任务（订阅自动更新 / 内核自动更新 / 定时重启） ============
  const SCHED_DEFAULTS = {
    sub_auto: false,
    sub_interval_h: 6,
    sub_mode: 'loop',
    kernel_auto: false,
    kernel_interval_h: 72,
    restart_hour: -1,
  };

  const readSchedule = async () => {
    const res = await runShellWithRoot(`cat ${SCHEDULE_FILE} 2>/dev/null`);
    const raw = (res.content || '').trim();
    if (!raw) return Object.assign({}, SCHED_DEFAULTS);
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const obj = m ? JSON.parse(m[0]) : null;
      return Object.assign({}, SCHED_DEFAULTS, obj || {});
    } catch (e) {
      return Object.assign({}, SCHED_DEFAULTS);
    }
  };

  const writeSchedule = async (sched) => {
    await runShellWithRoot(`mkdir -p ${F50MGR_DIR}/config
cat > ${SCHEDULE_FILE} <<'F50SCHEDEOF'
${JSON.stringify(sched, null, 2)}
F50SCHEDEOF
chmod 644 ${SCHEDULE_FILE}
echo SCHED_SAVED`);
  };

  // 定时守护脚本（设备端常驻循环）：读取 schedule.json 按间隔执行
  const SCHED_BODY = `#!/system/bin/sh
D=/data/adb/f50mgr
S=$D/config/schedule.json
LOG=$D/run/f50mgr-sched.log
BIN=$D/bin/f50mgr
WL=$D/bin/f50mgr-watch.sh
last_sub=0; last_ker=0; last_rst=0
log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }
while :; do
  [ -f "$S" ] || { sleep 30; continue; }
  now=$(date +%s)
  sub_auto=$(sed -n 's/.*"sub_auto"[[:space:]]*:[[:space:]]*\\([a-z]*\\).*/\\1/p' "$S" | head -1)
  sub_int=$(sed -n 's/.*"sub_interval_h"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$S" | head -1)
  ker_auto=$(sed -n 's/.*"kernel_auto"[[:space:]]*:[[:space:]]*\\([a-z]*\\).*/\\1/p' "$S" | head -1)
  ker_int=$(sed -n 's/.*"kernel_interval_h"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$S" | head -1)
  rst_hour=$(sed -n 's/.*"restart_hour"[[:space:]]*:[[:space:]]*\\(-*[0-9][0-9]*\\).*/\\1/p' "$S" | head -1)
  [ -n "$sub_auto" ] || sub_auto=false
  [ -n "$sub_int" ] || sub_int=0
  [ -n "$ker_auto" ] || ker_auto=false
  [ -n "$ker_int" ] || ker_int=0
  [ -n "$rst_hour" ] || rst_hour=-1
  if [ "$sub_auto" = true ] && [ "$sub_int" -gt 0 ] && [ $((now-last_sub)) -ge $((sub_int*3600)) ]; then
    last_sub=$now
    URL=$(grep -E '^url[[:space:]]*=' $D/config/secrets.toml 2>/dev/null | head -1 | sed 's/^url[[:space:]]*=[[:space:]]*"//; s/"$//')
    log "定时更新订阅"
    if [ -n "$URL" ]; then
      if [ -f $D/config/subfilter.conf ] && grep -Eq '^(converter|filter)=1' $D/config/subfilter.conf 2>/dev/null; then
        [ -x "$D/run/f50mgr-sub-update.sh" ] && sh "$D/run/f50mgr-sub-update.sh" >>"$LOG" 2>&1 && log "订阅更新完成（转换/筛选管线）"
      else
        "$BIN" subscription update "$URL" >>"$LOG" 2>&1 && log "订阅更新完成"
        [ -x "$D/bin/f50mgr-apply-overlay.sh" ] && sh "$D/bin/f50mgr-apply-overlay.sh" >>"$LOG" 2>&1
        pkill -f "$D/bin/mihomo" 2>/dev/null
        sleep 2
      fi
    else
      log "无订阅地址，跳过"
    fi
  fi
  if [ "$ker_auto" = true ] && [ "$ker_int" -gt 0 ] && [ $((now-last_ker)) -ge $((ker_int*3600)) ]; then
    last_ker=$now
    if ! grep -sq '^STATE=DOWNLOADING$' $D/run/update.status 2>/dev/null; then
      log "定时检查内核更新"
      [ -x "$D/run/f50mgr-update.sh" ] && nohup sh "$D/run/f50mgr-update.sh" >>"$LOG" 2>&1 &
    fi
  fi
  if [ "$rst_hour" -ge 0 ] && [ "$rst_hour" -lt 24 ]; then
    hh=$(date +%H); hh=\${hh#0}; [ -z "$hh" ] && hh=0
    if [ "$hh" = "$rst_hour" ] && [ $((now-last_rst)) -ge 3600 ]; then
      last_rst=$now
      log "定时重启 daemon"
      pkill -f 'f50mgr daemon' 2>/dev/null
      sleep 3
      pgrep -f 'f50mgr daemon' >/dev/null 2>&1 || { [ -x "$WL" ] && nohup sh "$WL" >/dev/null 2>&1 & }
    fi
  fi
  sleep 30
done`;

  // 部署定时守护脚本；启用 = 拉起进程 + 写开机自启行；关闭 = 停进程 + 移除自启行
  const ensureSched = async (sched) => {
    const any = sched.sub_auto || sched.kernel_auto || (sched.restart_hour >= 0 && sched.restart_hour <= 23);
    await runShellWithRoot(`
mkdir -p ${F50MGR_DIR}/bin ${F50MGR_DIR}/config ${F50MGR_DIR}/run
[ -f ${SCHED_SCRIPT} ] || {
cat > ${SCHED_SCRIPT} <<'F50SCHEDEOF'
${SCHED_BODY}
F50SCHEDEOF
chmod 755 ${SCHED_SCRIPT}
}
`);
    if (any) { await deployUpdateScript(); }
    if (any) {
      await runShellWithRoot(`
pkill -f 'f50mgr-sched.sh' 2>/dev/null
sleep 1
nohup sh ${SCHED_SCRIPT} >/dev/null 2>&1 &
grep -qxF '${SCHED_LINE}' ${BOOT_FILE} 2>/dev/null || echo '${SCHED_LINE}' >> ${BOOT_FILE}
echo SCHED_ON
`);
    } else {
      await runShellWithRoot(`
pkill -f 'f50mgr-sched.sh' 2>/dev/null
sed -i "\\|^${SCHED_LINE}$|d" ${BOOT_FILE} 2>/dev/null
echo SCHED_OFF
`);
    }
  };

  const editSchedule = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const sched = await readSchedule();
    const id1 = 'f50mgr_s_subh', id2 = 'f50mgr_s_kerh', id3 = 'f50mgr_s_rst';
    const ia = id1 + '_auto', ib = id2 + '_auto';
    const { el, close } = createFixedToast(
      'f50mgr_sched',
      `<div style="pointer-events:all;width:90vw;max-width:520px;">
      <div class="title" style="margin:0">定时任务</div>
      <div style="margin-top:10px;font-size:.7rem;line-height:1.75">设备端由 f50mgr-sched.sh 守护循环执行（启用时自动随开机自启拉起）；订阅/内核更新走与 MGR 网页控制台相同的下载通道。</div>
      <div style="margin-top:12px;font-size:.75rem;color:#eee;">📥 定时更新订阅</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:.7rem;color:#eee;">
        <label><input type="checkbox" id="${ia}" ${sched.sub_auto ? 'checked' : ''}> 自动更新</label>
        <select id="f50mgr_s_submode" style="padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;">
          <option value="loop" ${(sched.sub_mode || 'loop') === 'loop' ? 'selected' : ''}>循环</option>
        </select>
        <input type="number" id="${id1}" value="${sched.sub_interval_h}" min="1" max="720" style="width:76px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;"> 间隔(小时)
      </div>
      <div style="margin-top:10px;font-size:.75rem;color:#eee;">🔄 定时检查内核更新</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:.7rem;color:#eee;">
        <label><input type="checkbox" id="${ib}" ${sched.kernel_auto ? 'checked' : ''}> 启用</label>
        <input type="number" id="${id2}" value="${sched.kernel_interval_h}" min="1" max="2160" style="width:76px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;"> 间隔(小时)
      </div>
      <div style="margin-top:10px;font-size:.75rem;color:#eee;">⏹ 每天定时重启（整点）</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:.7rem;color:#eee;">
        <input type="number" id="${id3}" value="${sched.restart_hour}" min="-1" max="23" style="width:76px;padding:6px;border-radius:6px;border:1px solid #666;background:rgba(255,255,255,.08);color:#eee;"> 小时（-1=不启用）
      </div>
      <div style="margin-top:14px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
        <button class="ok">保存</button>
        <button class="cancel">取消</button>
      </div>
    </div>`,
    );
    const done = async () => {
      const q = (s) => el.querySelector('#' + s);
      const toInt = (v, d) => {
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? d : n;
      };
      const next = {
        sub_auto: !!(q(ia) && q(ia).checked),
        sub_interval_h: Math.max(1, toInt(q(id1) && q(id1).value, 6)),
        sub_mode: (q('f50mgr_s_submode') && q('f50mgr_s_submode').value) || 'loop',
        kernel_auto: !!(q(ib) && q(ib).checked),
        kernel_interval_h: Math.max(1, toInt(q(id2) && q(id2).value, 72)),
        restart_hour: Math.min(23, Math.max(-1, toInt(q(id3) && q(id3).value, -1))),
      };
      await writeSchedule(next);
      await ensureSched(next);
      createToast(next.sub_auto || next.kernel_auto || next.restart_hour >= 0 ? '定时任务已保存并启用' : '定时任务已关闭');
      close();
    };
    el.querySelector('.ok')?.addEventListener('click', () => done());
    el.querySelector('.cancel')?.addEventListener('click', () => close());
  };

  // ============ OpenClash 移植：多源内核更新（GitHub 官方 + 国内加速镜像自动回退） ============
  // 多源下载脚本：写 run/f50mgr-update.sh（手动/定时共用；若已在下载则幂等跳过）
  // 部署内核更新脚本（参数化：$1=branch stable|smart，$2=version latest|具体tag，$3=优先源BASE）
  const deployUpdateScript = async () => {
    await runShellWithRoot(`
rm -f ${F50MGR_DIR}/run/update.status ${F50MGR_DIR}/run/mihomo.new.gz ${F50MGR_DIR}/run/mihomo.new
cat > ${F50MGR_DIR}/run/f50mgr-update.sh <<'EOF'
#!/system/bin/sh
D=/data/adb/f50mgr/run
S=$D/update.status
BR=\${1:-stable}
VER=\${2:-latest}
BASE0=\${3:-}
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
[ -f $S ] && grep -q '^STATE=DOWNLOADING$' $S && exit 0
echo "STATE=DOWNLOADING" > $S
echo "PROGRESS=5" >> $S
# 手动安装包优先
if [ -f "$D/update.pkg.gz" ]; then
  rm -f "$D/mihomo.new.gz"; mv -f "$D/update.pkg.gz" "$D/mihomo.new.gz"
  echo "PROGRESS=15" >> $S
  rm -f "$D/update.tag"
  echo "SRC=MANUAL" >> $S
  TAG=$(cat "$D/update.tag" 2>/dev/null); [ -n "$TAG" ] && echo "TAG=$TAG" >> $S
else
  # 代理探测（config.yaml 端口逐个实测），TAG 获取与下载共用
  CFGY=$D/../config/clash/config.yaml
  PXY=""
  PORTS=$(grep -E '^(mixed-port|port|socks-port):' "$CFGY" 2>/dev/null | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d ' ' | tr '\n' ' ')
  PORTS=$(echo "$PORTS 14180 14194" | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' ')
  # 解析 mihomo 实际监听地址（CPE 环境可能绑 LAN 口 192.168.0.1 而非 127.0.0.1）
  LISTEN_IP=$(netstat -tlnp 2>/dev/null | awk '/:14180 / && /LISTEN/{print $4; exit}' | sed 's/:[0-9]*$//')
  [ -z "$LISTEN_IP" ] && LISTEN_IP=$(netstat -tlnp 2>/dev/null | awk '/LISTEN/ && /mihomo/{print $4; exit}' | sed 's/:[0-9]*$//')
  # 候选地址：实际监听 IP + 127.0.0.1 + 192.168.0.1（去重，跳过空）
  HOSTS=$(echo "$LISTEN_IP 127.0.0.1 192.168.0.1" | tr ' ' '\n' | awk 'NF && !seen[$0]++' | tr '\n' ' ')
  for PT in $PORTS; do
    [ -n "$PT" ] || continue
    for H in $HOSTS; do
      [ -n "$H" ] || continue
      if curl -m 3 -s -o /dev/null -x "http://$H:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="http://$H:$PT"; break 2; fi
      if curl -m 3 -s -o /dev/null -x "socks5h://$H:$PT" http://www.baidu.com/ 2>/dev/null; then PXY="socks5h://$H:$PT"; break 2; fi
    done
  done
  echo "PXY=$PXY" >> $S
  # F50 环境直连 GitHub 不通，代理探测失败直接报错，不再浪费时间试直连
  if [ -z "$PXY" ]; then
    echo "STATE=FAIL" >> $S
    echo "REASON=NO_PROXY" >> $S
    exit 1
  fi
  # TAG 获取：6 源并行直连（8s）→ 全失败并行走代理（10s）；快源（99988866 等）秒取，不再逐源白等
  # API 源（TAG 获取与资产提取共用；用户指定 TAG 时也必须可用）
  API_LIST="https://gh.api.99988866.xyz/https://api.github.com/repos/MetaCubeX/mihomo https://gh-proxy.com/https://api.github.com/repos/MetaCubeX/mihomo https://ghfast.top/https://api.github.com/repos/MetaCubeX/mihomo https://ghproxy.net/https://api.github.com/repos/MetaCubeX/mihomo https://api.github.com/repos/MetaCubeX/mihomo https://mirror.ghproxy.com/https://api.github.com/repos/MetaCubeX/mihomo"
  # TAG：用户指定版本号直接采用；latest 则通过代理拉最新 release 的 tag（6 源并行）
  if [ -n "$VER" ] && [ "$VER" != "latest" ]; then
    TAG="$VER"
  else
    rm -f $D/.t.*
    i=0
    for API in $API_LIST; do
      ( T=$(curl -m 10 -s -A "$UA" -x "$PXY" "$API/releases/latest" 2>/dev/null | grep -o '"tag_name":"[^"]*"' | head -1 | sed 's/.*:"//; s/"$//'); [ -n "$T" ] && echo "$T" > $D/.t.$i ) &
      i=$((i+1))
    done
    wait
    TAG=$(cat $D/.t.* 2>/dev/null | head -1)
    rm -f $D/.t.*
  fi
  echo "TAG=$TAG" >> $S
  echo "PROGRESS=25" >> $S
  # 资产名：Prerelease-Alpha 类 tag → 查该 release 资产提取 alpha 构建；普通 tag（v1.19.33 等）→ 直接拼资产名
  if echo "$TAG" | grep -qiE 'prerelease|alpha'; then
    A=""
    # 通道0：release 资产列表网页 expanded_assets（通过代理）
    for E in "https://github.com/MetaCubeX/mihomo/releases/expanded_assets/$TAG" "https://gh-proxy.com/https://github.com/MetaCubeX/mihomo/releases/expanded_assets/$TAG" "https://ghfast.top/https://github.com/MetaCubeX/mihomo/releases/expanded_assets/$TAG"; do
      A=$(curl -m 15 -sL -A "$UA" -x "$PXY" "$E" 2>/dev/null | grep -o 'mihomo-linux-arm64-alpha-[0-9a-f]*\.gz' | head -1)
      [ -n "$A" ] && break
    done
    # 通道1：releases?per_page=1 API 提取
    if [ -z "$A" ]; then
      for API in $API_LIST; do
        A=$(curl -m 10 -s -A "$UA" -x "$PXY" "$API/releases?per_page=1" 2>/dev/null | grep -o '"browser_download_url":"[^"]*mihomo-linux-arm64-alpha-[0-9a-f]*\.gz"' | head -1 | sed -E 's/.*alpha-/alpha-/; s/\.gz".*$//; s/"$//')
        [ -n "$A" ] && break
      done
    fi
    # 通道2：宽松提取任意 linux-arm64 资产文件名
    if [ -z "$A" ]; then
      for API in $API_LIST; do
        A=$(curl -m 10 -s -A "$UA" -x "$PXY" "$API/releases?per_page=1" 2>/dev/null | grep -o '"browser_download_url":"[^"]*mihomo-linux-arm64-[^"]*\.gz"' | head -1 | sed -E 's#.*/##; s/"$//')
        [ -n "$A" ] && break
      done
    fi
    [ -z "$A" ] && A="mihomo-linux-arm64-$TAG.gz"
  else
    A="mihomo-linux-arm64-$TAG.gz"
  fi
  echo "ASSET=$A" >> $S
  echo "PROGRESS=35" >> $S
  ALLB="https://github.com/MetaCubeX/mihomo/releases/download https://gh-proxy.com/https://github.com/MetaCubeX/mihomo/releases/download https://ghfast.top/https://github.com/MetaCubeX/mihomo/releases/download https://ghproxy.net/https://github.com/MetaCubeX/mihomo/releases/download https://gh.api.99988866.xyz/https://github.com/MetaCubeX/mihomo/releases/download https://mirror.ghproxy.com/https://github.com/MetaCubeX/mihomo/releases/download"
  if [ -n "$BASE0" ]; then BASES=$(echo "$BASE0 $ALLB" | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' '); else BASES="$ALLB"; fi
  GZ=$D/mihomo.new.gz
  rm -f $GZ $D/mihomo.new
  # 下载前通过代理并行测速（5s 上限），快源优先下载
  i=0
  for BASE in $BASES; do
    ( t=$(curl -m 5 -r 0-1023 -A "$UA" -x "$PXY" -o /dev/null -s -w '%{time_total}' "$BASE/$TAG/$A" 2>/dev/null); [ -z "$t" ] || [ "$t" = "0.000000" ] && t=999; echo "$t $BASE" > $D/.rk.$i ) &
    i=$((i+1))
  done
  wait
  LIST=$(for j in $(seq 0 $((i-1))); do cat $D/.rk.$j; done | sort -n | sed 's/^[0-9.]* //')
  # 99988866 快源强制第一（用户设备实测最快，测速异常也先试），去重
  LIST="https://gh.api.99988866.xyz/https://github.com/MetaCubeX/mihomo/releases/download $LIST"
  LIST=$(echo "$LIST" | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' ')
  rm -f $D/.rk.*
  echo "PROGRESS=45" >> $S
  OK=0
  # 两轮重试（网络抖动恢复）；update.sh 为 setsid 后台进程，curl 可长超时
  for ROUND in 1 2; do
    [ "$OK" = "1" ] && break
    for BASE in $LIST; do
      URL="$BASE/$TAG/$A"
      echo "URL=$URL" >> $S
      # 下载函数：直接 GET（不做 HEAD，避免反代镜像不支持 HEAD 卡 10s）
      # --connect-timeout 20 快速失败；stderr 落盘便于排查；实时回写已下载字节与速度
      DLDL() {
        OUT="$1"; URL="$2"; PROXY="$3"
        rm -f "$OUT" $D/.curl.err $D/.resp.hdr
        PX=""
        [ -n "$PROXY" ] && PX="-x $PROXY"
        curl -m 600 --connect-timeout 20 -sL -A "$UA" $PX -D "$D/.resp.hdr" -o "$OUT" "$URL" 2>$D/.curl.err &
        DLPI=$!
        PREV_B=0; PREV_T=$(date +%s 2>/dev/null || echo 0)
        TOTAL=0
        while kill -0 $DLPI 2>/dev/null; do
          sleep 2
          # 从响应头提取 Content-Length（第一次拿到后就不重复读）
          if [ "$TOTAL" -eq 0 ]; then
            TOTAL=$(grep -i '^content-length:' "$D/.resp.hdr" 2>/dev/null | tail -1 | tr -d '\r' | awk '{print $2}')
            [ -z "$TOTAL" ] && TOTAL=0
            [ "$TOTAL" -gt 0 ] && echo "DL_TOTAL=$TOTAL" >> $S
          fi
          NOW_B=$(wc -c < "$OUT" 2>/dev/null || echo 0)
          NOW_T=$(date +%s 2>/dev/null || echo 0)
          DT=$((NOW_T - PREV_T))
          [ $DT -lt 1 ] && DT=1
          SPD=$(( (NOW_B - PREV_B) / DT ))
          [ $SPD -lt 0 ] && SPD=0
          PREV_B=$NOW_B; PREV_T=$NOW_T
          echo "DL_BYTES=$NOW_B" >> $S
          echo "DL_SPEED=$SPD" >> $S
          if [ "$TOTAL" -gt 0 ]; then
            PCT=$(( 50 + NOW_B * 18 / TOTAL ))
            [ $PCT -lt 50 ] && PCT=50
            [ $PCT -gt 68 ] && PCT=68
          else
            PCT=55
          fi
          echo "PROGRESS=$PCT" >> $S
        done
        wait $DLPI
        RC=$?
        FB=$(wc -c < "$OUT" 2>/dev/null || echo 0)
        echo "DL_BYTES=$FB" >> $S
        echo "CURL_RC=$RC" >> $S
        ERR=$(head -c 400 $D/.curl.err 2>/dev/null | tr '\n' ' ')
        [ -n "$ERR" ] && echo "CURL_ERR=$ERR" >> $S
      }
      if [ -n "$PXY" ]; then
        DLDL "$GZ" "$URL" "$PXY"
        SZ=$(wc -c < $GZ 2>/dev/null); MAGIC=$(head -c 2 $GZ 2>/dev/null | od -An -tx1 | tr -d ' \n')
        # 只校验大小和 gzip 魔数（gunzip -t 在 toybox 上可能不支持会误删好文件；真正解压在后面 gunzip -f 验证）
        if [ -z "$SZ" ] || [ "$SZ" -le 100000 ] || [ "$MAGIC" != "1f8b" ]; then
          rm -f $GZ
        fi
      fi
      if [ -n "$SZ" ] && [ "$SZ" -gt 100000 ] && [ "$MAGIC" = "1f8b" ]; then
        OK=1; echo "SIZE=$SZ" >> $S; echo "SRC=$BASE" >> $S; echo "PROGRESS=70" >> $S; break
      fi
      rm -f $GZ
    done
    [ "$OK" = "1" ] || sleep 2
  done
  if [ "$OK" != "1" ]; then echo "STATE=FAIL" >> $S; echo "REASON=DL_FAIL" >> $S; rm -f $GZ; exit 1; fi
fi
echo "PROGRESS=80" >> $S
gunzip -f $D/mihomo.new.gz 2>/dev/null || { echo "STATE=FAIL" >> $S; echo "REASON=GUNZIP_FAIL" >> $S; exit 1; }
chmod 755 $D/mihomo.new
echo "PROGRESS=90" >> $S
V=$($D/mihomo.new -v 2>/dev/null | head -1)
if [ -z "$V" ]; then echo "STATE=FAIL" >> $S; echo "REASON=BIN_INVALID" >> $S; rm -f $D/mihomo.new; exit 1; fi
echo "NEW_VERSION=$V" >> $S
# 后端自替换（一次性）：备份→替换→权限→清理→重启 daemon，无需前端轮询代做
BIN=$D/../bin/mihomo
cp -f "$BIN" $D/mihomo.bak 2>/dev/null
mv -f $D/mihomo.new "$BIN"
chown root:net_admin "$BIN" 2>/dev/null
chmod 755 "$BIN"
chcon u:object_r:adb_data_file:s0 "$BIN" 2>/dev/null || true
V2=$("$BIN" -v 2>/dev/null | head -1)
if [ -z "$V2" ] && [ -f $D/mihomo.bak ]; then
  mv -f $D/mihomo.bak "$BIN"
  echo "STATE=FAIL" >> $S; echo "REASON=BIN_BROKEN_ROLLBACK" >> $S; exit 1
fi
rm -f $D/mihomo.new.gz $D/update.pkg.gz $D/update.tag
echo "REPLACED=1" >> $S
echo "PROGRESS=95" >> $S
echo "STATE=OK" >> $S
echo "PROGRESS=100" >> $S
pkill -f 'f50mgr daemon' 2>/dev/null
sleep 3
pgrep -f 'f50mgr daemon' >/dev/null 2>&1 || { [ -x $D/../bin/f50mgr-watch.sh ] && nohup sh $D/../bin/f50mgr-watch.sh >/dev/null 2>&1 & }
EOF
chmod 755 ${F50MGR_DIR}/run/f50mgr-update.sh
echo UPD_SCRIPT_DEPLOYED
`);
  };

  // ============ UI 构建 ============
  // 统一前置检查：需要 root 的操作必须先确认 UFI-TOOLS「高级功能」已开启
  const makeBtn = (text, onClick, needsRoot = true) => {
    const b = document.createElement('button');
    b.classList.add('btn');
    b.textContent = text;
    b.onclick = async () => {
      if (needsRoot) {
        if (!(await checkAdvanceFunc())) {
          createToast('未开启 UFI-TOOLS「高级功能」，无法获取 root！请先在设置中开启', 'red');
          return;
        }
      }
      try {
        await onClick();
      } catch (e) {
        createToast('操作出错：' + (e && e.message ? e.message : e), 'red');
      }
    };
    return b;
  };

  const refreshRunning = async () => {
    const el = document.querySelector('#f50mgr_running');
    const st = await getRunState();
    if (el) {
      el.textContent =
        st === 'R'
          ? 'f50mgr - 🟢运行中'
          : st === 'W'
            ? 'f50mgr - 🟡运行中(异常)'
            : 'f50mgr - 🔴已停止';
    }
  };

  // 开机自启按钮高亮：开启 = 官方主题高亮色 var(--dark-btn-color-active)，关闭 = 恢复正常样式
  const bootBtn = { el: null };
  const updateBootStyle = (btn, on) => {
    if (!btn) return;
    if (on) {
      btn.style.background = 'var(--dark-btn-color-active)';
      btn.style.color = '#fff';
      btn.style.fontWeight = 'bold';
    } else {
      btn.style.background = '';
      btn.style.color = '';
      btn.style.fontWeight = '';
      btn.style.boxShadow = '';
    }
  };

  (async () => {
    const wait = (sec = 100) =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, sec);
      });
    const container = document.querySelector('.functions-container');
    while (!UFI_DATA.lan_ipaddr) {
      await wait();
    }

    container.insertAdjacentHTML(
      'afterend',
      `
<div id="IFRAME_KANO_f50mgr" style="width: 100%; margin-top: 10px;">
    <div class="title" style="margin: 6px 0;">
        <strong id="f50mgr_running">f50mgr</strong>
        <div style="display: inline-block;" id="f50mgr_collapse_btn"></div>
    </div>
    <div class="collapse" id="f50mgr_collapse" data-name="close" style="height: 0px; overflow: hidden;">
        <div class="collapse_box">
        <div id="f50mgr_action_box" style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap"></div>
            <ul class="deviceList">
<li style="padding:10px">
        <div id="f50mgr_latency_wrap">
        <div id="f50mgr_latency" style="border:1.5px solid rgba(52,120,246,.5);border-radius:10px;padding:12px;background:rgba(0,0,0,.18);opacity:.9;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <div style="flex:1;min-width:190px;border-radius:8px;padding:10px;background:rgba(34,197,94,.08);">
                    <div style="font-size:13px;color:#fff;">🇨🇳 国内延迟（直连）</div>
                    <div id="lat_dom" style="font-size:30px;font-weight:800;">--</div>
                    <div style="font-size:12px;color:#fff;">百度 <span id="lat_baidu">--</span> · 腾讯 <span id="lat_qq">--</span> · 网易 <span id="lat_163">--</span></div>
                </div>
                <div style="flex:1;min-width:190px;border-radius:8px;padding:10px;background:rgba(34,197,94,.08);">
                    <div style="font-size:13px;color:#fff;">🌐 国外延迟（代理）</div>
                    <div id="lat_frn" style="font-size:30px;font-weight:800;">--</div>
                    <div style="font-size:12px;color:#fff;">Google <span id="lat_google">--</span> · YouTube <span id="lat_yt">--</span> · X <span id="lat_x">--</span></div>
                </div>
            </div>
            <div id="lat_note" style="font-size:12px;color:#fff;margin-top:8px;">加载中…</div>
            <div id="lat_geo" style="font-size:11px;color:#cbd5e1;margin-top:4px;"></div>
        </div>
        </div>
</li> </ul>
        </div>
    </div>
</div>
`,
    );

    // 折叠开关：直接用官方 collapseGen 生成，样式与官方 toggle 完全一致
    const cb = document.querySelector('#f50mgr_collapse_btn');
    if (cb && typeof collapseGen === 'function') {
      collapseGen('#f50mgr_collapse_btn', '#f50mgr_collapse', '#f50mgr_collapse', (e) => {
        if (e === 'close') {
          // 收起时停掉测延迟轮询
          if (latSwLabel && latSwLabel.__timer) {
            clearInterval(latSwLabel.__timer);
            latSwLabel.__timer = null;
          }
        }
      });
    } else if (cb) {
      // 兜底：collapseGen 不可用时用简单按钮
      cb.textContent = '收起/展开';
      cb.style.cssText = 'cursor:pointer;font-size:.7rem;color:#22d3ee;';
      cb.onclick = () => {
        const coll = document.querySelector('#f50mgr_collapse');
        if (!coll) return;
        coll.style.height = coll.style.height === '0px' ? 'auto' : '0px';
      };
    }

    const box = document.querySelector('#f50mgr_action_box');

    // 操作按钮：导入组件（安装）与卸载放最右边
    const btns = [
      ['▶ 启动', () => startF50()],
      ['⏹ 停止', () => stopF50()],
      ['🔄 重启', () => restartF50()],
      // —— OpenClash 移植：订阅管理（订阅设置请用 MGR 控制台/更新订阅内直接填 URL） ——
      ['📥 更新订阅', () => updateSubscribe()],
      ['📚 订阅管理', () => subscribeManager()],
      ['📋 订阅状态', () => showSubscribeStatus()],
      ['🗑 清空订阅', () => clearSubscribe()],
      // —— OpenClash 移植：规则 / 白名单 / 配置 ——
      ['🗂 规则集', () => ruleManager()],
      ['🛠 自定义规则', () => editCustomRules()],
      ['📄 配置文件', () => showConfig()],
      // —— OpenClash 移植：运行模式 / 节点选择 ——
      ['⚙️ 运行设置', () => modeSettings()],
      ['🧭 代理选择', () => proxySelector()],
      // —— OpenClash 移植：定时任务 / 多源内核更新 ——
      ['⏰ 定时任务', () => editSchedule()],
      ['🔄 版本更新', () => updateManager()],
      // —— 原有功能 ——
      ['📊 状态', () => showStatus()],
      ['🔑 管理密钥', () => showAuth()],
      ['♻ 重置密钥', () => resetAuth()],
      ['🖥 主控制面板', () => openUI(), false],
      ['📜 查看日志', () => showLog()],
      ['🛏 开机自启', async () => {
        const on = await checkIsBootUp();
        if (!(await askConfirm('f50mgr_boot', on ? '关闭开机自启？' : '开启开机自启？', on ? '开机将不再自动拉起 f50mgr。' : '开机自动拉起 f50mgr（含守护循环，防 TPROXY 黑洞）。'))) return;
        await toggleBoot();
        const nowOn = await checkIsBootUp();
        updateBootStyle(bootBtn.el, nowOn);
      }],
      ['📦 导入组件', async () => {
        if (await checkIsInstalled()) {
          if (!(await askConfirm('f50mgr_reimport', '已安装过，再次导入？', '导入组件包：覆盖安装（保留现有 config 与密钥）。导入备份包（带 BACKUP.info）：全量还原（覆盖 config/密钥/自启状态）。'))) return;
        }
        zipInput.click();
      }],
      ['💾 备份', () => backupAll()],
      ['🗑 卸载', () => uninstallF50()],
    ];
    btns.forEach(([t, fn, needsRoot]) => {
      const b = makeBtn(t, fn, needsRoot);
      box.appendChild(b);
      if (t.includes('开机自启')) {
        bootBtn.el = b;
        checkIsBootUp().then((on) => updateBootStyle(b, on));
      }
    });

    // 测延迟开关（放最后）：默认收起；点开 = 展开延迟界面并测速（30s 循环）；再点 = 停止并收起
    const latSwLabel = document.createElement('button');
    latSwLabel.className = 'btn';
    latSwLabel.innerHTML =
      '<span style="font-size:13px;">📶 测延迟</span>' +
      '<span id="f50mgr_lat_arrow" style="font-size:12px;opacity:.8;margin-left:4px;">▲</span>';
    box.appendChild(latSwLabel);
    const latArrow = document.getElementById('f50mgr_lat_arrow');
    let latOn = false;
    const setLatencyOn = (on) => {
      latOn = !!on;
      if (latArrow) latArrow.textContent = latOn ? '▼' : '▲';
      const wrap = document.getElementById('f50mgr_latency_wrap');
      if (wrap) wrap.style.display = latOn ? '' : 'none';
      if (latOn) {
        refreshLatency();
        if (!latSwLabel.__timer) latSwLabel.__timer = setInterval(refreshLatency, 30000);
      } else {
        if (latSwLabel.__timer) {
          clearInterval(latSwLabel.__timer);
          latSwLabel.__timer = null;
        }
      }
    };
    latSwLabel.onclick = () => setLatencyOn(!latOn);
    // 默认关闭收起
    setLatencyOn(false);

    // 隐藏的文件选择器（导入组件 / 还原备份包）
    const zipInput = document.createElement('input');
    zipInput.type = 'file';
    zipInput.accept = '.zip,.tar,.tgz,.gz';
    zipInput.style.display = 'none';
    zipInput.onchange = async () => {
      const file = zipInput.files && zipInput.files[0];
      zipInput.value = '';
      if (!file) return;
      const low = file.name.toLowerCase();
      if (!/(\.zip|\.tar|\.tgz|\.tar\.gz)$/.test(low)) {
        createToast('请选择 .zip / .tar.gz 文件', 'red');
        return;
      }
      if (file.size > 110 * 1024 * 1024) {
        createToast('文件过大（>110MB）', 'red');
        return;
      }
      const url = await saveZip(file);
      if (!url) {
        createToast('上传失败', 'red');
        return;
      }
      await importZip(url);
    };
    document.body.appendChild(zipInput);

    refreshRunning();
    const timer = setInterval(refreshRunning, 5000);
    // 面板地址跟随：按实际监听 IP 轮询，F50 换网段/重启导致监听 IP 变化时自动刷新延迟面板
    let lastIp = '';
    const ipTimer = setInterval(async () => {
      const cur = await detectMgrIp();
      if (cur && cur !== lastIp) {
        lastIp = cur;
        refreshLatency();
      }
    }, 10000);
    window.addEventListener('beforeunload', () => {
      clearInterval(timer);
      clearInterval(ipTimer);
      const ls = document.getElementById('f50mgr_lat_sw');
      if (ls && ls.__timer) clearInterval(ls.__timer);
    });
  })();
})();
//（注：内容由AI生成）