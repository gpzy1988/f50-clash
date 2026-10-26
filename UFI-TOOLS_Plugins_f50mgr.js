//<script>
// 防御性兜底：UFI 平台/其他插件可能引用全局 TAG，避免 "TAG is not defined" 报错
try { if (typeof window !== 'undefined' && typeof window.TAG === 'undefined') window.TAG = 'f50mgr'; } catch (e) {}
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

  // 导入组件：zip/tar.gz 均可（Magisk 模块包 = 安装；带 BACKUP.info 的备份包 = 全量还原）
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
AUTH_OUT="$(${F50MGR_BIN} auth ensure 2>&1)"
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
# daemon 启动 + Web 就绪需要时间，最多等 15 秒
UP=''
i=0
while [ $i -lt 15 ]; do
  if pgrep -f 'f50mgr daemon' >/dev/null 2>&1 && netstat -tlnp 2>/dev/null | grep -q ':14180 .*LISTEN'; then
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
          : `安装成功，daemon 已运行 (PID ${pid})`,
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
AUTH_OUT="$(${F50MGR_BIN} auth ensure 2>&1)"
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
while :; do
    "$F50MGR_BIN" daemon
    rc=$?
    echo "$(date '+%Y-%m-%d %H:%M:%S') f50mgr: daemon exited rc=$rc, restarting in 5s" >> "$F50MGR_DATA_DIR/run/f50mgr.log"
    sleep 5
done
WATCH_EOF
chmod 755 ${F50MGR_WATCH}
[ -f ${F50MGR_WATCH} ] || { echo 'WATCH_DEPLOY_FAIL'; exit 1; }
# 清理临时文件 + 拉起守护循环
rm -rf ${F50MGR_DIR}/.install ${F50MGR_DIR}/.install.zip ${F50MGR_DIR}/.install.tar.gz ${F50MGR_DIR}/.install.pkg
nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
# daemon 启动 + Web 就绪需要时间，最多等 15 秒
UP=''
i=0
while [ $i -lt 15 ]; do
  if pgrep -f 'f50mgr daemon' >/dev/null 2>&1 && netstat -tlnp 2>/dev/null | grep -q ':14180 .*LISTEN'; then
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

  const toggleBoot = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const on = await checkIsBootUp();
    // 猫猫同款：写/删 boot.sh 钩子行（UFI 平台开机执行，不依赖 Magisk）；关闭时同时杀掉当前 watch/daemon 防止内存复活
    const res = await runShellWithRoot(
      on
        ? `sed -i "\\|^${BOOT_LINE}$|d" ${BOOT_FILE} 2>/dev/null; pkill -f 'f50mgr-watch.sh' 2>/dev/null; pkill -f 'f50mgr daemon' 2>/dev/null; echo OFF`
        : `grep -qxF '${BOOT_LINE}' ${BOOT_FILE} 2>/dev/null || echo '${BOOT_LINE}' >> ${BOOT_FILE}; echo ON`,
    );
    createToast(
      res.content.includes('ON') ? '已开启开机自启（boot.sh 钩子，不依赖 Magisk）' : '已关闭开机自启',
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

  // 打开 Mihomo 面板（MetaCubeXD，14193/ui/）：地址动态跟随 F50 实际监听 IP，不带密钥，直接打开
  const openMihomoUI = async () => {
    const ip = await detectMgrIp();
    const a = document.createElement('a');
    a.href = `http://${ip}:14193/ui/?t=` + Date.now();
    a.target = '_blank';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 延迟面板渲染：国内直连 / 国外代理 延迟（插件自测，不依赖 f50mgr API）
  const renderLat = (baidu, qq, n163, google, yt, x, note = '') => {
    const set = (id, text, ok) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.style.color = ok === null ? '' : ok ? '#22c55e' : '#ef4444';
    };
    const ms = (v) => (v == null ? '--' : `${v} ms`);
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
  };

  // 刷新延迟面板：6 站全部经 LAN 侧 IP + mihomo HTTP 入站探测（规则分流：国内 DIRECT / 国外走节点，与真实上网同链路），入站不可用时回退直连
  const refreshLatency = async () => {
    const box = document.getElementById('f50mgr_latency');
    if (!box) return;
    const res = await runShellWithRoot(`
IP=$(netstat -tlnp 2>/dev/null | awk '/:14180 / && /LISTEN/{print $4; exit}' | sed 's/:[0-9]*$//')
[ -n "$IP" ] || IP=192.168.0.1
T=${F50MGR_DIR}/run
CFG=${F50MGR_DIR}/config/clash/config.yaml
EC=$(grep '^external-controller:' "$CFG" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '"')
[ -z "$EC" ] && EC=$IP:14193
SECRET=$(grep -E '^secret:' "$CFG" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d '"')
A1=""; A2=""
[ -n "$SECRET" ] && { A1="-H"; A2="Authorization: Bearer $SECRET"; }
# 确保 mihomo 有 HTTP/SOCKS 入站：优先已有 mixed-port/port，其次 socks-port，否则注入 mixed-port 并热加载
HP=$(grep -E '^(mixed-port|port):' "$CFG" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d ' ')
SP=$(grep -E '^socks-port:' "$CFG" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*//' | tr -d ' ')
PXY=""
if [ -n "$HP" ]; then PXY="http://$IP:$HP";
elif [ -n "$SP" ]; then PXY="socks5h://$IP:$SP";
else
  echo "mixed-port: 14194" >> "$CFG" 2>/dev/null
  curl -s -m 6 $A1 "$A2" -X PUT "http://$EC/configs?force=true" -d @"$CFG" >/dev/null 2>&1
  PXY="http://$IP:14194"
fi
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
    const note = pCnt >= 4
      ? '全部经 mihomo 规则分流（LAN 侧 IP 探测）：国内直连·国外节点；30 秒自动刷新'
      : dCnt > 0 || (b != null || q != null || n163 != null || g != null || yt != null || x != null)
        ? '部分站点经 mihomo，部分回退直连（参考值）'
        : '延迟不可测（mihomo 入站不可达且无直连）';
    renderLat(b, q, n163, g, yt, x, note);
  };

  // 手动更新 mihomo 内核：GitHub 官方拉最新 arm64 → 校验 → 替换 → 重启 daemon
  // 手动更新 mihomo 内核（两阶段）：
  // 阶段1：写入下载脚本并 nohup 后台下载（服务不中断），状态写入 run/update.status
  // 阶段2：轮询状态，下载+校验 OK 后自动备份→替换→重启 daemon（短脚本避免平台超时）
  const updateKernel = async () => {
    if (!(await checkIsInstalled())) {
      createToast('尚未安装 f50mgr，请先「导入组件」', 'red');
      return;
    }
    const busy = await runShellWithRoot(`grep -s '^STATE=DOWNLOADING$' ${F50MGR_DIR}/run/update.status 2>/dev/null`);
    if (busy.content && busy.content.includes('DOWNLOADING')) {
      createToast('已有更新任务在后台下载中，请稍候', 'red');
      return;
    }
    if (!(await askConfirm('f50mgr_uk1', '手动更新内核？', '将在后台从 mihomo 官方 GitHub 下载最新 arm64 内核（当前服务不中断）；下载校验完成后自动备份旧内核并替换 /data/adb/f50mgr/bin/mihomo、重启 daemon 生效。'))) return;
    const start = await runShellWithRoot(`
rm -f ${F50MGR_DIR}/run/update.status ${F50MGR_DIR}/run/mihomo.new.gz ${F50MGR_DIR}/run/mihomo.new
cat > ${F50MGR_DIR}/run/f50mgr-update.sh <<'EOF'
#!/system/bin/sh
D=/data/adb/f50mgr/run
S=$D/update.status
echo "STATE=DOWNLOADING" > $S
TAG=$(curl -m 20 -s https://api.github.com/repos/MetaCubeX/mihomo/releases/latest | grep '"tag_name"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
if [ -z "$TAG" ]; then echo "STATE=FAIL" >> $S; echo "REASON=NO_TAG" >> $S; exit 1; fi
echo "TAG=$TAG" >> $S
URL="https://github.com/MetaCubeX/mihomo/releases/download/$TAG/mihomo-linux-arm64-$TAG.gz"
echo "URL=$URL" >> $S
curl -m 600 -sL -o $D/mihomo.new.gz "$URL" 2>/dev/null || { echo "STATE=FAIL" >> $S; echo "REASON=DL_FAIL" >> $S; exit 1; }
SZ=$(wc -c < $D/mihomo.new.gz 2>/dev/null)
echo "SIZE=$SZ" >> $S
MAGIC=$(head -c 2 $D/mihomo.new.gz | od -An -tx1 | tr -d ' \\n')
echo "MAGIC=$MAGIC" >> $S
if [ "$MAGIC" != "1f8b" ]; then echo "STATE=FAIL" >> $S; echo "REASON=NOT_GZIP" >> $S; rm -f $D/mihomo.new.gz; exit 1; fi
gunzip -f $D/mihomo.new.gz 2>/dev/null || { echo "STATE=FAIL" >> $S; echo "REASON=GUNZIP_FAIL" >> $S; exit 1; }
chmod 755 $D/mihomo.new
V=$($D/mihomo.new -v 2>/dev/null | head -1)
if [ -z "$V" ]; then echo "STATE=FAIL" >> $S; echo "REASON=BIN_INVALID" >> $S; rm -f $D/mihomo.new; exit 1; fi
echo "NEW_VERSION=$V" >> $S
echo "STATE=OK" >> $S
EOF
chmod 755 ${F50MGR_DIR}/run/f50mgr-update.sh
nohup sh ${F50MGR_DIR}/run/f50mgr-update.sh > ${F50MGR_DIR}/run/update.log 2>&1 &
echo 'STARTED'
`);
    const sout = (start.content || '').trim();
    if (!sout.includes('STARTED')) {
      createToast('启动下载失败，请查看输出', 'red');
      showTextDialog('f50mgr_uk_res', '启动失败', sout.slice(0, 800));
      return;
    }
    createToast('已在后台下载最新内核（服务不中断），下载完成后自动替换重启');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 阶段2：轮询状态（最长 10 分钟）
    for (let i = 0; i < 120; i++) {
      await sleep(5000);
      const st = await runShellWithRoot(`cat ${F50MGR_DIR}/run/update.status 2>/dev/null`);
      const s = (st.content || '').trim();
      if (s.includes('STATE=OK')) {
        const nv = (s.match(/NEW_VERSION=(.*)/) || [])[1] || '';
        const tg = (s.match(/TAG=(.*)/) || [])[1] || '';
        const cur = await runShellWithRoot(`${F50MGR_DIR}/bin/mihomo -v 2>/dev/null | head -1`);
        const curv = (cur.content || '').trim() || '?';
        // 应用：备份→替换→重启（短脚本，几秒完成，不会超时）
        const app = await runShellWithRoot(`
D=${F50MGR_DIR}/run
cp -f ${F50MGR_DIR}/bin/mihomo $D/mihomo.bak 2>/dev/null
mv -f $D/mihomo.new ${F50MGR_DIR}/bin/mihomo
chown root:net_admin ${F50MGR_DIR}/bin/mihomo 2>/dev/null
chmod 755 ${F50MGR_DIR}/bin/mihomo
chcon u:object_r:adb_data_file:s0 ${F50MGR_DIR}/bin/mihomo 2>/dev/null || true
echo 'REPLACED'
pkill -f 'f50mgr daemon' 2>/dev/null
sleep 3
if ! pgrep -f 'f50mgr daemon' >/dev/null 2>&1; then
  nohup sh ${F50MGR_WATCH} >/dev/null 2>&1 &
  sleep 4
fi
pgrep -f 'f50mgr daemon' | head -1 || echo 'DAEMON_NOT_UP'
`);
        const aout = (app.content || '').trim();
        if (aout.includes('REPLACED')) {
          createToast(`内核已更新：${curv} → ${nv || tg}，daemon 已重启`);
          showTextDialog('f50mgr_uk_res', '内核更新完成', `旧内核：${curv}\n新内核：${nv || tg}\n${aout}`);
        } else {
          createToast('替换异常，请查看输出', 'red');
          showTextDialog('f50mgr_uk_res', '替换输出', aout.slice(0, 1200));
        }
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
        createToast((map[reason] || '下载失败') + '，内核未改动', 'red');
        showTextDialog('f50mgr_uk_res', '下载失败', s.slice(0, 1500));
        return;
      }
    }
    createToast('下载超时（10 分钟），请检查网络后重试', 'red');
    const fin = await runShellWithRoot(`cat ${F50MGR_DIR}/run/update.status 2>/dev/null`);
    showTextDialog('f50mgr_uk_res', '下载超时', (fin.content || '') || '状态文件为空');
  };

  // 卸载：三次确认 → 停进程 → 删开机自启 → 删除全部数据
  const uninstallF50 = async () => {
    if (!(await checkIsInstalled())) {
      createToast('未检测到已安装的 f50mgr', 'red');
      return;
    }
    if (!(await askConfirm('f50mgr_rm1', '卸载 f50mgr？', '将停止守护进程，并删除 /data/adb/f50mgr 全部数据（配置、管理密钥、日志、mihomo/EasyTier 内核、Web 面板）。'))) return;
    if (!(await askConfirm('f50mgr_rm2', '再次确认', '此操作不可恢复：管理密钥、订阅链接与所有配置都会永久丢失。'))) return;
    if (!(await askConfirm('f50mgr_rm3', '最后一次确认', '确定要彻底卸载并清空全部数据吗？'))) return;
    const res = await runShellWithRoot(`
pkill -f 'f50mgr-watch.sh'
pkill -f 'f50mgr daemon'
sleep 1
sed -i "\\|^${BOOT_LINE}$|d" ${BOOT_FILE} 2>/dev/null
rm -rf ${F50MGR_DIR}
echo UNINSTALL_DONE
`);
    const out = (res.content || '').trim();
    if (out.includes('UNINSTALL_DONE')) {
      createToast('已卸载，全部数据已删除');
      refreshRunning();
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
mkdir -p "$BK/bin" "$BK/config/clash" "$BK/config/easytier" "$BK/data/orig_scripts" "$BK/run"
cp -f ${F50MGR_DIR}/bin/f50mgr "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/bin/mihomo "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/bin/easytier "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/bin/easytier-cli "$BK/bin/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/f50mgr.toml "$BK/config/" 2>/dev/null
cp -f ${F50MGR_DIR}/config/secrets.toml "$BK/config/" 2>/dev/null
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

  // 开机自启按钮高亮：开启 = 与测延迟滑块同色（蓝色）高亮，关闭 = 恢复正常样式
  const bootBtn = { el: null };
  const updateBootStyle = (btn, on) => {
    if (!btn) return;
    if (on) {
      btn.style.background = '#3478f6';
      btn.style.color = '#fff';
      btn.style.fontWeight = 'bold';
      btn.style.boxShadow = '0 0 10px rgba(52,120,246,.55)';
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
        </div>
        </div>
</li> </ul>
        </div>
    </div>
</div>
`,
    );

    // 折叠开关（滑块样式：开=展开面板，关=收起）
    const cb = document.querySelector('#f50mgr_collapse_btn');
    if (cb) {
      const coll = document.querySelector('#f50mgr_collapse');
      const setPanel = (open) => {
        coll.dataset.name = open ? 'open' : 'close';
        coll.style.height = open ? 'auto' : '0px';
        const sw = document.getElementById('f50mgr_sw');
        if (sw) sw.checked = !!open;
      };
      cb.innerHTML =
        '<style>' +
        '.f50mgr_sw{position:relative;display:inline-block;width:44px;height:24px;vertical-align:middle;cursor:pointer;user-select:none}' +
        '.f50mgr_sw input{display:none}' +
        '.f50mgr_sw .bar{position:absolute;inset:0;background:#c9cdd4;border-radius:12px;transition:background .2s}' +
        '.f50mgr_sw .bar:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}' +
        '.f50mgr_sw input:checked + .bar{background:#3478f6}' +
        '.f50mgr_sw input:checked + .bar:before{transform:translateX(20px)}' +
        '</style>' +
        '<label class="f50mgr_sw" title="展开/收起面板">' +
        '<input type="checkbox" id="f50mgr_sw" checked>' +
        '<span class="bar"></span>' +
        '</label>';
      const sw = document.getElementById('f50mgr_sw');
      if (sw) sw.onchange = () => setPanel(sw.checked);
      setPanel(true);
    }

    const box = document.querySelector('#f50mgr_action_box');

    // 操作按钮：导入组件（安装）与卸载放最右边
    const btns = [
      ['▶ 启动', () => startF50()],
      ['⏹ 停止', () => stopF50()],
      ['🔄 重启', () => restartF50()],
      ['📊 状态', () => showStatus()],
      ['🔑 管理密钥', () => showAuth()],
      ['♻ 重置密钥', () => resetAuth()],
      ['🖥 打开MGR面板', () => openUI(), false],
      ['🖥 Mihomo节点面板', () => openMihomoUI(), false],
      ['📜 查看日志', () => showLog()],
      ['🔄 手动更新内核', () => updateKernel()],
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

    // 测延迟开关（放最后）：开 = 展开延迟界面并测速（30s 循环）；关 = 停止测速并收起延迟界面
    const latSwLabel = document.createElement('label');
    latSwLabel.style.cssText =
      'display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:4px 2px;user-select:none;';
    latSwLabel.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(52,120,246,.55);background:rgba(52,120,246,.18);border-radius:8px;padding:3px 8px;cursor:pointer;">' +
      '<span style="font-size:13px;color:#eee;">📶 测延迟</span>' +
      '<span id="f50mgr_lat_arrow" style="display:inline-block;width:26px;height:26px;border-radius:5px;background:#3478f6;color:#fff;font-size:14px;font-weight:bold;text-align:center;line-height:26px;">▲</span>' +
      '</span>' +
      '<input type="checkbox" id="f50mgr_lat_sw" checked style="display:none;">';
    box.appendChild(latSwLabel);
    const latSw = document.getElementById('f50mgr_lat_sw');
    const latArrow = document.getElementById('f50mgr_lat_arrow');
    const setLatBtn = (on) => {
      if (!latArrow) return;
      latArrow.textContent = on ? '▼' : '▲';
      latArrow.style.background = on ? '#3478f6' : '#7a7f89';
      latArrow.style.boxShadow = on ? '0 0 8px rgba(52,120,246,.6)' : 'none';
    };
    const setLatencyOn = (on) => {
      latSw.checked = !!on;
      setLatBtn(!!on);
      const wrap = document.getElementById('f50mgr_latency_wrap');
      if (wrap) wrap.style.display = on ? '' : 'none';
      if (on) {
        refreshLatency();
        if (!latSw.__timer) latSw.__timer = setInterval(refreshLatency, 30000);
      } else {
        if (latSw.__timer) {
          clearInterval(latSw.__timer);
          latSw.__timer = null;
        }
      }
    };
    if (latSw) latSw.onchange = () => setLatencyOn(latSw.checked);
    // 面板收起（折叠）时，强制关闭测延迟（停掉 30s 轮询）
    const collapseSw = document.getElementById('f50mgr_sw');
    if (collapseSw) collapseSw.addEventListener('change', () => {
      if (!collapseSw.checked && latSw.checked) setLatencyOn(false);
    });
    setLatencyOn(true);

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